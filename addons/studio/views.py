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

from .models import Brief, Creative, GenerationRun
from .serializers import BriefSerializer, CreativeSerializer, GenerateRequest, RunSerializer
from .tasks import generate_scripts

logger = logging.getLogger(__name__)


def get_app(request, workspace_id, app_id, *, write=False):
    workspace = workspace_access(request.user, workspace_id, write=write, module="studio")
    return get_object_or_404(MobileApp, workspace=workspace, pk=app_id)


def default_brief(app):
    snapshot = app.snapshots.first()
    return {
        "audience": snapshot.data.get("audience", "") if snapshot else "",
        "goal": "Encourage people to try the app.",
        "tone": "Clear and friendly",
    }


@api_view(["GET", "PUT"])
def brief(request, workspace_id, app_id):
    app = get_app(request, workspace_id, app_id, write=request.method == "PUT")
    existing = Brief.objects.filter(app=app).first()
    if request.method == "GET":
        return Response(BriefSerializer(existing).data if existing else default_brief(app))
    serializer = BriefSerializer(instance=existing, data=request.data)
    serializer.is_valid(raise_exception=True)
    serializer.save(app=app)
    return Response(serializer.data)


@api_view(["GET", "POST"])
def runs(request, workspace_id, app_id):
    app = get_app(request, workspace_id, app_id, write=request.method == "POST")
    if request.method == "GET":
        return Response(RunSerializer(app.runs.prefetch_related("creatives")[:20], many=True).data)
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
        run, created = GenerationRun.objects.get_or_create(
            workspace=app.workspace,
            request_id=serializer.validated_data["request_id"],
            defaults={"app": app, "inputs": inputs, "created_by": request.user},
        )
        if run.app_id != app.id or run.inputs != inputs:
            return Response({"error": "This request ID has already been used."}, status=409)
        if created:

            def dispatch():
                try:
                    generate_scripts.delay(str(run.pk))
                except Exception:
                    logger.exception("Could not enqueue run %s", run.pk)
                    GenerationRun.objects.filter(pk=run.pk).update(
                        status=GenerationRun.Status.FAILED,
                        error="The task service is unavailable. Please try again later.",
                    )

            transaction.on_commit(dispatch)
    run.refresh_from_db()
    return Response(RunSerializer(run).data, status=202 if created else 200)


@api_view(["PATCH"])
def edit_creative(request, workspace_id, creative_id):
    workspace = workspace_access(request.user, workspace_id, write=True, module="studio")
    creative = get_object_or_404(Creative, pk=creative_id, run__workspace=workspace)
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
    lines = [f"# {run.app.name} — scripts", "", "Demo mode: writing templates, no AI calls.", ""]
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
    response = HttpResponse("\n".join(lines), content_type="text/markdown; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="panda-scripts-{run.pk}.md"'
    return response
