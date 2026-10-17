import logging
import threading

from celery import shared_task
from django.conf import settings
from django.db import close_old_connections, connections

from panda_store.ai.providers import ProviderError
from panda_store.core.credentials import CredentialsUnavailable
from panda_store.workflows import services

from . import editorial, grounding
from .models import AuditRun
from .rules import audit, localized_metadata

logger = logging.getLogger(__name__)


@shared_task(
    soft_time_limit=2 * settings.PANDA_AI_TIMEOUT_SECONDS + 60,
    time_limit=2 * settings.PANDA_AI_TIMEOUT_SECONDS + 90,
)
def audit_listing(workflow_id):
    run = AuditRun.objects.get(workflow_id=workflow_id)
    token = services.claim(workflow_id)
    if token is None:
        return
    stopped = threading.Event()

    def keep_alive():
        try:
            while not stopped.wait(10):
                close_old_connections()
                if not services.heartbeat(workflow_id, token):
                    return
        finally:
            connections.close_all()

    heartbeat = threading.Thread(target=keep_alive, daemon=True)
    if "ai" in run.inputs:
        heartbeat.start()
    try:
        saved = services.start_step(
            workflow_id, token, "listing", "Reading the saved localization."
        )
        if saved is None:
            text = localized_metadata(run.inputs["metadata"], run.locale)
            services.complete_step(
                workflow_id,
                token,
                "listing",
                f"{len(text)} text fields available for {run.locale}. Using the saved import.",
                {"snapshot_id": run.inputs["snapshot_id"], "locale": run.locale},
            )
        services.heartbeat(workflow_id, token)
        report = services.start_step(
            workflow_id, token, "checks", "Checking field limits and exact keyword repetition."
        )
        if report is None:
            report = audit(run.inputs)
            counts = report["counts"]
            services.complete_step(
                workflow_id,
                token,
                "checks",
                f"{counts['issue']} issues; {counts['recommendation']} recommendations. "
                "Source references and coverage recorded.",
                report,
            )
        services.heartbeat(workflow_id, token)
        if "ai" in run.inputs:
            choice = run.inputs["ai"]
            examples = sum(
                note["source"].get("kind") == "public_listing_observation"
                for note in run.inputs["knowledge"]
            )
            output = services.start_step(
                workflow_id,
                token,
                "editorial",
                f"Reviewing {run.locale} text with {choice['provider']} / {choice['model']}. "
                f"Using {len(run.inputs['knowledge'])} saved reference notes, including "
                f"{examples} public listing examples. No live web research.",
            )
            if output is None:
                output = editorial.analyze(run, report["checks"])
                services.complete_step(
                    workflow_id,
                    token,
                    "editorial",
                    "Model response received. Checking evidence and field constraints.",
                    output,
                )
            validated = services.start_step(
                workflow_id,
                token,
                "validate",
                "Checking quoted evidence, source IDs and proposed field lengths.",
            )
            if validated is None:
                validated = editorial.validate(output, run.inputs, report)
                info = validated["editorial"]
                coverage = (
                    f"{info['reviewed_fields']} of 5 field reviews validated. "
                    if "reviewed_fields" in info
                    else ""
                )
                services.complete_step(
                    workflow_id,
                    token,
                    "validate",
                    coverage + f"{info['accepted_proposals']} proposals retained for human review; "
                    f"{info['rejected_proposals']} rejected by validation.",
                    validated,
                )
            checked = services.start_step(
                workflow_id,
                token,
                "grounding",
                "Reviewing observations and proposals against the imported text. "
                "This is a second model call.",
            )
            if checked is None:
                checked = grounding.review(run, validated)
                # Validate completeness before checkpointing; a malformed review must be retried.
                report = grounding.apply(checked, run.inputs, validated)
                info = report["editorial"]["grounding"]
                services.complete_step(
                    workflow_id,
                    token,
                    "grounding",
                    f"{info['reviewed_items']} items reviewed against the listing; "
                    f"{info['withheld_observations']} observations and "
                    f"{info['withheld_proposals']} proposals withheld.",
                    checked,
                )
            else:
                report = grounding.apply(checked, run.inputs, validated)
        services.start_step(workflow_id, token, "report", "Saving the audit and source references.")
        with services.execution_lock(workflow_id, token):
            run.report = report
            run.save(update_fields=["report"])
            services.complete_step(workflow_id, token, "report", "Findings saved for review.")
            services.succeed(workflow_id, token, "Audit complete. Your store listing is unchanged.")
    except services.ExecutionStopped:
        services.fail(workflow_id, "The worker lease expired. Retry the unfinished steps.", token)
    except (ProviderError, CredentialsUnavailable) as exc:
        services.fail(workflow_id, str(exc), token)
    except Exception:
        logger.exception("ASO audit failed for %s", run.pk)
        services.fail(workflow_id, "The audit failed. Retry the unfinished steps.", token)

    finally:
        stopped.set()
        if heartbeat.is_alive():
            heartbeat.join(timeout=2)
