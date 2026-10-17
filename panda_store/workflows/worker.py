"""Local database worker. Compose uses Celery with the same execution adapter."""

import importlib
import logging

from django.db import close_old_connections

from panda_store.core.registry import get_registry

from .models import WorkflowRun
from .services import fail, recover

logger = logging.getLogger(__name__)


def tick():
    close_old_connections()
    for run_id in WorkflowRun.objects.filter(status__in=["running", "canceling"]).values_list(
        "pk", flat=True
    ):
        recover(run_id)
    run = WorkflowRun.objects.filter(status="queued").order_by("created_at").first()
    if run is None:
        return False
    try:
        module = get_registry().modules[run.module_id]
        adapter = importlib.import_module(f"{module.package}.workflow")
        version, execute = adapter.RUNNERS[run.workflow_key]
        if version != run.version:
            fail(run.pk, "The workflow changed. Create a new session.")
            return True
        execute(run.pk)
    except Exception:
        logger.exception("Workflow dispatch failed for %s", run.pk)
        # Do not interrupt an attempt another worker already claimed.
        if WorkflowRun.objects.filter(pk=run.pk, status="queued").exists():
            fail(run.pk, "The workflow runner is unavailable. Check the worker and retry.")
    finally:
        close_old_connections()
    return True
