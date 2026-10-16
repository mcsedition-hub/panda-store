import logging

from celery import shared_task
from django.db import transaction
from django.utils import timezone

from .models import Creative, GenerationRun
from .providers import generate_demo_scripts

logger = logging.getLogger(__name__)


@shared_task
def generate_scripts(run_id):
    # A duplicated broker delivery must not create a second set of creatives.
    with transaction.atomic():
        run = GenerationRun.objects.select_for_update().get(pk=run_id)
        if run.status != GenerationRun.Status.QUEUED:
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
            error="La génération n’a pas abouti. Vous pouvez lancer une nouvelle tentative.",
            completed_at=timezone.now(),
        )
