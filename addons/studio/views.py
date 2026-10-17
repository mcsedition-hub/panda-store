import logging

from django.conf import settings
from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from addons.app_catalog.models import MobileApp
from panda_store.core.access import workspace_access
from panda_store.core.models import Workspace
from panda_store.workflows.models import WorkflowRun
from panda_store.workflows.services import fail, recover

from .models import Brief, Creative, GenerationRun
from .serializers import BriefSerializer, CreativeSerializer, GenerateRequest, RunSerializer
from .tasks import generate_scripts
from .workflow import VERSION, create_workflow

logger = logging.getLogger(__name__)


def dispatch_generation(run):
    if settings.PANDA_WORKFLOW_DISPATCH == "database":
        return  # The local worker claims the durable queued record.
    try:
        if run.provider == "demo_templates":
            generate_scripts.delay(str(run.pk))
        else:
            from .creative_tasks import generate_ai_scripts

            generate_ai_scripts.delay(str(run.pk))
    except Exception:
        logger.exception("Could not enqueue run %s", run.pk)
        fail(run.workflow_id, "The task service is unavailable. Start the worker and retry.")
        workflow = WorkflowRun.objects.get(pk=run.workflow_id)
        GenerationRun.objects.filter(pk=run.pk).update(
            status=workflow.status,
            error=workflow.error,
            completed_at=workflow.completed_at,
        )


def get_app(request, workspace_id, app_id, *, write=False):
    workspace = workspace_access(request.user, workspace_id, write=write, module="studio")
    return get_object_or_404(MobileApp, workspace=workspace, pk=app_id)


def default_brief(app):
    snapshot = app.snapshots.first()
    return {
        "audience": snapshot.data.get("audience", "") if snapshot else "",
        "goal": "Encourage people to try the app.",
        "tone": "Clear and friendly",
        "research": None,
        "research_page_ids": [],
        "research_sources": [],
        "product_facts": "",
        "language": "English",
        "duration_seconds": 30,
    }


@api_view(["GET", "PUT"])
def brief(request, workspace_id, app_id):
    app = get_app(request, workspace_id, app_id, write=request.method == "PUT")
    existing = Brief.objects.filter(app=app).first()
    if request.method == "GET":
        return Response(BriefSerializer(existing).data if existing else default_brief(app))
    serializer = BriefSerializer(instance=existing, data=request.data, context={"app": app})
    serializer.is_valid(raise_exception=True)
    serializer.save(app=app)
    return Response(serializer.data)


@api_view(["GET", "POST"])
def runs(request, workspace_id, app_id):
    app = get_app(request, workspace_id, app_id, write=request.method == "POST")
    if request.method == "GET":
        recent = list(app.runs.select_related("workflow").prefetch_related("creatives")[:20])
        for run in recent:
            if run.workflow_id and not run.workflow.terminal:
                recover(run.workflow_id)
                run.workflow.refresh_from_db()
        return Response(RunSerializer(recent, many=True).data)
    if not settings.PANDA_DEMO_MODE:
        raise PermissionDenied("The demo provider is disabled.")
    serializer = GenerateRequest(data=request.data)
    serializer.is_valid(raise_exception=True)
    snapshot = app.snapshots.first()
    if snapshot is None:
        raise ValidationError("Import app metadata before creating scripts.")
    saved_brief = Brief.objects.filter(app=app).first()
    brief_data = BriefSerializer(saved_brief).data if saved_brief else default_brief(app)
    inputs = {"metadata": snapshot.data, "snapshot_id": str(snapshot.pk), "brief": brief_data}
    with transaction.atomic():
        Workspace.objects.select_for_update().get(pk=app.workspace_id)
        workspace_access(request.user, workspace_id, write=True, module="studio")
        run, created = GenerationRun.objects.get_or_create(
            workspace=app.workspace,
            request_id=serializer.validated_data["request_id"],
            defaults={"app": app, "inputs": inputs, "created_by": request.user},
        )
        if run.app_id != app.id or run.inputs != inputs:
            return Response({"error": "This request ID has already been used."}, status=409)
        if created:
            create_workflow(run)
            transaction.on_commit(lambda: dispatch_generation(run))
    run.refresh_from_db()
    return Response(RunSerializer(run).data, status=202 if created else 200)


@api_view(["POST"])
def retry_run(request, workspace_id, run_id):
    workspace = workspace_access(request.user, workspace_id, write=True, module="studio")
    original = get_object_or_404(GenerationRun, pk=run_id, workspace=workspace)
    if original.provider != "demo_templates":
        from .creative_views import retry_ai

        return retry_ai(request, workspace, original)
    if not settings.PANDA_DEMO_MODE:
        raise PermissionDenied("The demo provider is disabled.")
    serializer = GenerateRequest(data=request.data)
    serializer.is_valid(raise_exception=True)
    original = get_object_or_404(GenerationRun, pk=run_id, workspace=workspace)
    if not original.workflow_id:
        raise ValidationError("Create a new session to track this older generation.")
    recover(original.workflow_id)
    with transaction.atomic():
        Workspace.objects.select_for_update().get(pk=workspace.pk)
        workspace_access(request.user, workspace_id, write=True, module="studio")
        workflow = WorkflowRun.objects.select_for_update().get(pk=original.workflow_id)
        existing = GenerationRun.objects.filter(workflow__retry_of=workflow).first()
        if existing:
            return Response(RunSerializer(existing).data)
        if workflow.status not in {WorkflowRun.Status.FAILED, WorkflowRun.Status.CANCELED}:
            raise ValidationError("Only failed or canceled workflows can be retried.")
        if workflow.version != VERSION or workflow.workflow_key != "studio.scripts":
            raise ValidationError("This workflow changed. Create a new session.")
        request_id = serializer.validated_data["request_id"]
        if GenerationRun.objects.filter(workspace=workspace, request_id=request_id).exists():
            return Response({"error": "This request ID has already been used."}, status=409)
        run = GenerationRun.objects.create(
            workspace=workspace,
            app=original.app,
            inputs=original.inputs,
            provider=original.provider,
            created_by=request.user,
            request_id=request_id,
        )
        create_workflow(run, retry_of=workflow)
        transaction.on_commit(lambda: dispatch_generation(run))
    run.refresh_from_db()
    return Response(RunSerializer(run).data, status=202)


@api_view(["PATCH"])
def edit_creative(request, workspace_id, creative_id):
    workspace = workspace_access(request.user, workspace_id, write=True, module="studio")
    with transaction.atomic():
        Workspace.objects.select_for_update().get(pk=workspace.pk)
        workspace_access(request.user, workspace_id, write=True, module="studio")
        creative = get_object_or_404(
            Creative.objects.select_for_update(), pk=creative_id, run__workspace=workspace
        )
        serializer = CreativeSerializer(creative, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        changed = any(
            field in serializer.validated_data
            and serializer.validated_data[field] != getattr(creative, field)
            for field in ("hook", "script", "cta")
        )
        # An edit always needs a new, separate approval, including API clients.
        serializer.save(**({"approved": False} if changed else {}))
        return Response(serializer.data)


@api_view(["GET"])
def export_run(request, workspace_id, run_id):
    workspace = workspace_access(request.user, workspace_id, module="studio")
    run = get_object_or_404(
        GenerationRun.objects.select_related("app").prefetch_related("creatives"),
        pk=run_id,
        workspace=workspace,
        status=GenerationRun.Status.SUCCEEDED,
    )
    mode = (
        "Demo mode: writing templates, no AI calls."
        if run.provider == "demo_templates"
        else (
            f"AI drafts: {run.provider} / {run.inputs['ai']['model']}. "
            "Review before recording or publishing."
        )
    )
    lines = [f"# {run.app.name} — scripts", "", mode, ""]
    if run.provider != "demo_templates":
        lines += [
            "## Brief",
            "",
            f"Language: {run.inputs['brief']['language']}",
            f"Target duration: {run.inputs['brief']['duration_seconds']} seconds (estimate)",
            "",
            "Product facts confirmed by the author:",
            run.inputs["brief"]["product_facts"],
            "",
            "## Research references",
            "",
        ]
        for source in run.inputs["sources"]:
            lines += [f"- {source['title']}: {source['url']} (captured {source['captured_at']})"]
        lines += ["", "References inform structure; they do not prove performance.", ""]
    for creative in run.creatives.all():
        lines += [
            f"## {creative.variant}. {creative.angle}",
            "",
            f"Hook: {creative.hook}",
            "",
            creative.script,
            "",
            f"Call to action: {creative.cta}",
            "",
            f"Review: {'approved' if creative.approved else 'needs review'}",
            "",
        ]
        if creative.provenance:
            lines += [
                "Original research adaptation (not rechecked after edits):",
                creative.provenance["adaptation"],
                "",
            ]
            for source in run.inputs["sources"]:
                if source["page_id"] in creative.provenance["source_page_ids"]:
                    lines += [f"- {source['title']}: {source['url']}"]
            lines += [""]
    response = HttpResponse("\n".join(lines), content_type="text/markdown; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="panda-scripts-{run.pk}.md"'
    return response
