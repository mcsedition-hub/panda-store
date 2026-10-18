import logging
import threading

from celery import shared_task
from django.db import close_old_connections, connections, transaction
from django.utils import timezone

from panda_store.workflows import services
from panda_store.workflows.models import WorkflowRun

from .models import Creative, GenerationRun
from .providers import generate_demo_scripts
from .workflow import create_workflow

logger = logging.getLogger(__name__)


@transaction.atomic
def update_generation(run):
    workflow = WorkflowRun.objects.select_for_update().get(pk=run.workflow_id)
    GenerationRun.objects.filter(pk=run.pk).update(
        status=workflow.status,
        error=workflow.error,
        completed_at=workflow.completed_at,
    )


@shared_task
def generate_scripts(run_id):
    with transaction.atomic():
        run = GenerationRun.objects.select_for_update().get(pk=run_id)
        if not run.workflow_id:
            if run.status != GenerationRun.Status.QUEUED:
                return
            create_workflow(run)
    token = services.claim(run.workflow_id)
    if token is None:
        update_generation(run)
        return
    GenerationRun.objects.filter(pk=run.pk).update(status=GenerationRun.Status.RUNNING)
    stopped = threading.Event()

    def keep_alive():
        try:
            while not stopped.wait(10):
                close_old_connections()
                if not services.heartbeat(run.workflow_id, token):
                    return
        except Exception:
            logger.exception("Workflow heartbeat failed for %s", run.workflow_id)
        finally:
            connections.close_all()

    heartbeat = threading.Thread(target=keep_alive, daemon=True)
    heartbeat.start()
    try:
        context = services.start_step(
            run.workflow_id, token, "context", "Reading the saved metadata and brief."
        )
        if context is None:
            if not run.inputs.get("metadata", {}).get("name") or not run.inputs.get("brief"):
                raise ValueError("Incomplete generation inputs")
            services.complete_step(
                run.workflow_id,
                token,
                "context",
                "Saved app metadata and brief checked. This attempt keeps the same inputs.",
                {"snapshot_id": run.inputs["snapshot_id"]},
            )
        scripts = services.start_step(
            run.workflow_id, token, "scripts", "Creating scripts from local writing templates."
        )
        if scripts is None:
            scripts = generate_demo_scripts(run.inputs)
            if len(scripts) != 3:
                raise ValueError("Expected three scripts")
            services.complete_step(
                run.workflow_id,
                token,
                "scripts",
                "Three template scripts created. No AI calls.",
                scripts,
            )
        services.start_step(run.workflow_id, token, "save", "Saving scripts for your review.")
        # Persist outputs and complete the workflow in one fenced transaction.
        with services.execution_lock(run.workflow_id, token):
            Creative.objects.bulk_create([Creative(run=run, **script) for script in scripts])
            services.complete_step(
                run.workflow_id, token, "save", "Three scripts saved. Approval is still required."
            )
            services.succeed(run.workflow_id, token, "Scripts saved. Ready for your review.")
            GenerationRun.objects.filter(pk=run.pk).update(
                status=GenerationRun.Status.SUCCEEDED, completed_at=timezone.now(), error=""
            )
    except services.ExecutionStopped:
        services.fail(
            run.workflow_id, "The worker lease expired. Retry the unfinished steps.", token
        )
    except Exception:
        logger.exception("Script generation failed for run %s", run.pk)
        services.fail(
            run.workflow_id, "Script generation failed. You can retry the unfinished steps.", token
        )
    finally:
        stopped.set()
        heartbeat.join(timeout=2)
        update_generation(run)


# Celery discovers this conventional module; register the Studio tasks split into
# separate files as well. Keep this after the shared helpers used by those modules.
from . import creative_tasks, render_tasks, research_tasks, social_tasks  # noqa: E402, F401
