import logging

from celery import shared_task
from django.db import transaction
from django.utils import timezone

from panda_store.core.models import Workspace

from .models import Creative, GenerationRun
from .providers import generate_demo_scripts

logger = logging.getLogger(__name__)


@shared_task
def generate_scripts(run_id):
    # A duplicated broker delivery must not create a second set of creatives.
    workspace_id = GenerationRun.objects.values_list("workspace_id", flat=True).get(pk=run_id)
    with transaction.atomic():
        # Share the activation lock so disabling and starting a job have a defined order.
        workspace = Workspace.objects.select_for_update().get(pk=workspace_id)
        run = GenerationRun.objects.select_for_update().get(pk=run_id)
        if run.status != GenerationRun.Status.QUEUED:
            return
        if not workspace.modules.filter(module_id="studio").exists():
            run.status = GenerationRun.Status.FAILED
            run.error = "Studio was disabled before this generation started."
            run.completed_at = timezone.now()
            run.save(update_fields=["status", "error", "completed_at"])
            return
        run.status = GenerationRun.Status.RUNNING
        run.save(update_fields=["status"])
    try:
        scripts = generate_demo_scripts(run.inputs)
        with transaction.atomic():
            Creative.objects.bulk_create([Creative(run=run, **script) for script in scripts])
            run.status = GenerationRun.Status.SUCCEEDED
            run.completed_at = timezone.now()
            run.save(update_fields=["status", "completed_at"])
    except Exception:
        logger.exception("Script generation failed for run %s", run.pk)
        GenerationRun.objects.filter(pk=run.pk).update(
            status=GenerationRun.Status.FAILED,
            error="Script generation failed. You can start a new attempt.",
            completed_at=timezone.now(),
        )
