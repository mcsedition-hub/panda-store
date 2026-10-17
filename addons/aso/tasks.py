import logging

from celery import shared_task

from panda_store.workflows import services

from .models import AuditRun
from .rules import audit, localized_metadata

logger = logging.getLogger(__name__)


@shared_task
def audit_listing(workflow_id):
    run = AuditRun.objects.get(workflow_id=workflow_id)
    token = services.claim(workflow_id)
    if token is None:
        return
    try:
        # These bounded local checks do not call providers or perform network I/O.
        # Renew between steps; every write remains fenced by the workflow lease.
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
        services.start_step(workflow_id, token, "report", "Saving the audit and source references.")
        with services.execution_lock(workflow_id, token):
            run.report = report
            run.save(update_fields=["report"])
            services.complete_step(workflow_id, token, "report", "Findings saved for review.")
            services.succeed(workflow_id, token, "Audit complete. Your store listing is unchanged.")
    except services.ExecutionStopped:
        services.fail(workflow_id, "The worker lease expired. Retry the unfinished steps.", token)
    except Exception:
        logger.exception("ASO audit failed for %s", run.pk)
        services.fail(workflow_id, "The audit failed. Retry the unfinished steps.", token)
