import logging

from django.conf import settings
from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from addons.app_catalog.models import MobileApp
from panda_store.ai.providers import PROVIDERS
from panda_store.core.access import workspace_access
from panda_store.core.models import AIConnection, Workspace
from panda_store.workflows.models import WorkflowRun
from panda_store.workflows.services import fail, recover

from . import editorial, grounding, visual
from .models import AuditRun, ScreenshotEvidence
from .rules import RULESET, localized_metadata
from .tasks import audit_listing
from .workflow import AI_VERSION, VERSION, VISUAL_VERSION, create_workflow

logger = logging.getLogger(__name__)


class AuditRequest(serializers.Serializer):
    request_id = serializers.UUIDField()
    locale = serializers.CharField(max_length=35)
    snapshot_id = serializers.UUIDField()
    provider = serializers.ChoiceField(choices=list(PROVIDERS), required=False)
    model = serializers.CharField(max_length=120, required=False)
    mode = serializers.ChoiceField(choices=["listing", "screenshots"], default="listing")

    def validate(self, attrs):
        if ("provider" in attrs) != ("model" in attrs):
            raise ValidationError("Choose both a provider and a model, or use rules only.")
        if attrs["mode"] == "screenshots" and "provider" not in attrs:
            raise ValidationError("Choose a provider and model to review screenshots.")
        return attrs


class RetryRequest(serializers.Serializer):
    request_id = serializers.UUIDField()


def serialize(run):
    return {
        "id": str(run.pk),
        "mode": run.inputs.get("mode", "listing"),
        "workflow_id": str(run.workflow_id),
        "status": run.workflow.status,
        "error": run.workflow.error,
        "locale": run.locale,
        "created_at": run.created_at,
        "snapshot_id": run.inputs["snapshot_id"],
        "captured_at": run.inputs["captured_at"],
        "source": run.inputs["source"],
        "is_demo": run.inputs["is_demo"],
        "report": run.report,
        "knowledge": run.inputs.get("knowledge", []),
        "knowledge_version": run.inputs.get("knowledge_version"),
        "ai": {key: run.inputs["ai"][key] for key in ("provider", "model")}
        if "ai" in run.inputs
        else None,
    }


def dispatch(workflow_id):
    if settings.PANDA_WORKFLOW_DISPATCH == "database":
        return
    try:
        audit_listing.delay(str(workflow_id))
    except Exception:
        logger.exception("Could not enqueue ASO workflow %s", workflow_id)
        fail(workflow_id, "The task service is unavailable. Start the worker and retry.")


@api_view(["GET"])
def knowledge(request, workspace_id):
    workspace_access(request.user, workspace_id, module="aso")
    if request.query_params.get("mode") == "screenshots":
        return Response({"version": visual.KNOWLEDGE_VERSION, "entries": visual.knowledge()})
    return Response({"version": editorial.KNOWLEDGE_VERSION, "entries": editorial.knowledge()})


@api_view(["GET", "POST"])
def runs(request, workspace_id, app_id):
    workspace = workspace_access(
        request.user, workspace_id, write=request.method == "POST", module="aso"
    )
    app = get_object_or_404(MobileApp, workspace=workspace, pk=app_id)
    if request.method == "GET":
        recent = list(app.aso_audits.select_related("workflow")[:50])
        for run in recent:
            if not run.workflow.terminal:
                recover(run.workflow_id)
                run.workflow.refresh_from_db()
        return Response([serialize(run) for run in recent])
    data = AuditRequest(data=request.data)
    data.is_valid(raise_exception=True)
    values = data.validated_data
    if app.platform != "ios":
        raise ValidationError("This audit currently supports App Store listings only.")
    snapshot = get_object_or_404(app.snapshots, pk=values["snapshot_id"])
    try:
        localized_metadata(snapshot.data, values["locale"])
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc
    inputs = {
        "metadata": snapshot.data,
        "snapshot_id": str(snapshot.pk),
        "captured_at": snapshot.captured_at.isoformat(),
        "source": snapshot.source,
        "is_demo": app.is_demo,
        "platform": app.platform,
        "locale": values["locale"],
        "ruleset": RULESET,
    }
    screenshots = values["mode"] == "screenshots"
    if screenshots:
        if not snapshot.data.get("screenshots") or (
            snapshot.data.get("screenshots_locale") != values["locale"]
        ):
            raise ValidationError("No screenshots were imported for this language.")
        inputs.update(mode="screenshots", visual_version=visual.VERSION)
    with transaction.atomic():
        Workspace.objects.select_for_update().get(pk=workspace.pk)
        workspace_access(request.user, workspace_id, write=True, module="aso")
        if "provider" in values:
            connection = AIConnection.objects.filter(
                workspace=workspace, provider=values["provider"]
            ).first()
            if not connection:
                raise ValidationError("Connect this provider in AI settings first.")
            if values["model"] not in [item["id"] for item in connection.model_catalog]:
                raise ValidationError("Choose an available model or refresh models in AI settings.")
            inputs["ai"] = {
                "provider": connection.provider,
                "model": values["model"],
                "connection_id": str(connection.pk),
                "revision": str(connection.revision),
                "prompt_version": editorial.VERSION,
                "max_output_tokens": editorial.MAX_OUTPUT_TOKENS,
                "grounding_version": grounding.VERSION,
                "grounding_max_output_tokens": grounding.MAX_OUTPUT_TOKENS,
            }
            inputs["knowledge"] = (
                visual.knowledge() if screenshots else editorial.knowledge(platform=app.platform)
            )
            inputs["knowledge_version"] = (
                visual.KNOWLEDGE_VERSION if screenshots else editorial.KNOWLEDGE_VERSION
            )
            if not screenshots:
                inputs["field_criteria"] = editorial.FIELD_CRITERIA
        run = AuditRun.objects.filter(workspace=workspace, request_id=values["request_id"]).first()
        created = run is None
        if run:
            if run.app_id != app.pk or run.inputs != inputs:
                return Response({"error": "This request ID has already been used."}, status=409)
        else:
            workflow = create_workflow(
                workspace, request.user, ai="ai" in inputs, screenshots=screenshots
            )
            run = AuditRun.objects.create(
                workspace=workspace,
                app=app,
                workflow=workflow,
                inputs=inputs,
                locale=values["locale"],
                request_id=values["request_id"],
            )
            transaction.on_commit(lambda: dispatch(workflow.pk))
    run.refresh_from_db()
    return Response(serialize(run), status=202 if created else 200)


@api_view(["POST"])
def retry(request, workspace_id, run_id):
    workspace = workspace_access(request.user, workspace_id, write=True, module="aso")
    data = RetryRequest(data=request.data)
    data.is_valid(raise_exception=True)
    original = get_object_or_404(AuditRun, pk=run_id, workspace=workspace)
    recover(original.workflow_id)
    with transaction.atomic():
        Workspace.objects.select_for_update().get(pk=workspace.pk)
        workspace_access(request.user, workspace_id, write=True, module="aso")
        previous = WorkflowRun.objects.select_for_update().get(pk=original.workflow_id)
        existing = (
            AuditRun.objects.filter(workflow__retry_of=previous).select_related("workflow").first()
        )
        if existing:
            return Response(serialize(existing))
        if previous.status not in {WorkflowRun.Status.FAILED, WorkflowRun.Status.CANCELED}:
            raise ValidationError("Only failed or canceled audits can be retried.")
        screenshots = original.inputs.get("mode") == "screenshots"
        if (
            previous.version
            != (
                VISUAL_VERSION
                if screenshots
                else AI_VERSION
                if "ai" in original.inputs
                else VERSION
            )
            or (screenshots and original.inputs.get("visual_version") != visual.VERSION)
            or original.inputs["ruleset"] != RULESET
            or (
                "ai" in original.inputs
                and (
                    original.inputs["ai"]["prompt_version"] != editorial.VERSION
                    or original.inputs["ai"].get("grounding_version") != grounding.VERSION
                )
            )
        ):
            raise ValidationError("The audit rules changed. Start a new audit.")
        request_id = data.validated_data["request_id"]
        if AuditRun.objects.filter(workspace=workspace, request_id=request_id).exists():
            return Response({"error": "This request ID has already been used."}, status=409)
        workflow = create_workflow(
            workspace,
            request.user,
            retry_of=previous,
            ai="ai" in original.inputs,
            screenshots=screenshots,
        )
        run = AuditRun.objects.create(
            workspace=workspace,
            app=original.app,
            workflow=workflow,
            inputs=original.inputs,
            locale=original.locale,
            request_id=request_id,
        )
        transaction.on_commit(lambda: dispatch(workflow.pk))
    run.refresh_from_db()
    return Response(serialize(run), status=202)


@api_view(["GET"])
def image(request, workspace_id, image_id):
    workspace_access(request.user, workspace_id, module="aso")
    asset = get_object_or_404(ScreenshotEvidence, pk=image_id, audit__workspace_id=workspace_id)
    response = HttpResponse(bytes(asset.data), content_type="image/jpeg")
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response
