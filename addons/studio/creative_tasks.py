import logging
import threading

from celery import shared_task
from django.conf import settings
from django.db import close_old_connections, connections

from panda_store.ai.providers import ProviderError
from panda_store.core.credentials import CredentialsUnavailable
from panda_store.workflows import services

from . import creative_ai as ai
from .models import Creative, GenerationRun
from .tasks import update_generation

logger = logging.getLogger(__name__)


@shared_task(
    soft_time_limit=2 * settings.PANDA_AI_TIMEOUT_SECONDS + 60,
    time_limit=2 * settings.PANDA_AI_TIMEOUT_SECONDS + 90,
)
def generate_ai_scripts(run_id):
    run = GenerationRun.objects.get(pk=run_id)
    token = services.claim(run.workflow_id)
    if token is None:
        update_generation(run)
        return
    update_generation(run)
    stopped = threading.Event()

    def keep_alive():
        try:
            while not stopped.wait(10):
                close_old_connections()
                if not services.heartbeat(run.workflow_id, token):
                    return
        finally:
            connections.close_all()

    heartbeat = threading.Thread(target=keep_alive, daemon=True)
    heartbeat.start()
    try:
        context = services.start_step(
            run.workflow_id,
            token,
            "context",
            "Checking the frozen brief, selected sources and AI connection.",
        )
        if context is None:
            ai.key_for(run)
            services.complete_step(
                run.workflow_id,
                token,
                "context",
                "Product facts confirmed by the author. Research is inspiration, not proof.",
                {
                    "snapshot_id": run.inputs["snapshot_id"],
                    "research_id": run.inputs["research_id"],
                },
            )
        output = services.start_step(
            run.workflow_id,
            token,
            "scripts",
            "Writing three original directions from the selected observations.",
        )
        if output is None:
            output = ai.call(run)
            ai.validate_scripts(output, run.inputs)
            services.complete_step(
                run.workflow_id,
                token,
                "scripts",
                "Three proposals received. Source and claim quotes checked.",
                output,
            )
        scripts = ai.validate_scripts(output, run.inputs)
        review = services.start_step(
            run.workflow_id,
            token,
            "verify",
            "Reviewing product claims, distinct angles and research adaptation.",
        )
        if review is None:
            review = ai.call(run, scripts)
            ai.validate_review(review)
            services.complete_step(
                run.workflow_id,
                token,
                "verify",
                "Automated review finished. Human approval remains separate.",
                review,
            )
        checks = ai.validate_review(review)
        with services.execution_lock(run.workflow_id, token):
            run.review = {
                "rejected": any(not c["supported"] for c in checks),
                "checks": checks,
                "calls": [
                    {
                        "step": name,
                        "model": data.get("resolved_model", run.inputs["ai"]["model"]),
                        "usage": data.get("usage", {}),
                    }
                    for name, data in (("scripts", output), ("verify", review))
                ],
            }
            run.save(update_fields=["review"])
        if run.review["rejected"]:
            raise ProviderError(
                "The review rejected one or more scripts. No scripts were saved. "
                "Read the review, adjust the brief and start a new generation."
            )
        services.start_step(
            run.workflow_id, token, "save", "Saving three drafts with their research references."
        )
        with services.execution_lock(run.workflow_id, token):
            Creative.objects.bulk_create(
                [
                    Creative(
                        run=run,
                        **{k: script[k] for k in ("variant", "angle", "hook", "script", "cta")},
                        provenance={
                            k: script[k]
                            for k in (
                                "source_page_ids",
                                "adaptation",
                                "product_claims",
                                "content_format",
                            )
                            if k in script
                        },
                    )
                    for script in scripts
                ]
            )
            services.complete_step(
                run.workflow_id,
                token,
                "save",
                "Three editable scripts saved. Review before recording or publishing.",
            )
            services.succeed(run.workflow_id, token, "Three scripts ready for your review.")
    except services.ExecutionStopped:
        services.fail(run.workflow_id, "The worker stopped. Retry the unfinished steps.", token)
    except (ProviderError, CredentialsUnavailable) as exc:
        services.fail(run.workflow_id, str(exc), token)
    except Exception:
        logger.exception("AI script generation failed for %s", run.pk)
        services.fail(
            run.workflow_id,
            "Script generation failed. Retry unfinished steps; completed work is retained.",
            token,
        )
    finally:
        stopped.set()
        heartbeat.join(timeout=2)
        update_generation(run)
