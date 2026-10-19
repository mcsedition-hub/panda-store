import copy
import json

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from addons.app_catalog.models import MobileApp
from panda_store.ai.providers import PROVIDERS
from panda_store.ai.retries import AIRetryRequest, matches_retry_choice, retry_choice
from panda_store.core.access import workspace_access
from panda_store.core.models import AIConnection, Workspace
from panda_store.workflows import services
from panda_store.workflows.models import WorkflowRun

from .creative_ai import VERSION
from .creative_context import selected_sources
from .models import GenerationRun
from .serializers import RunSerializer
from .views import dispatch_generation
from .workflow import AI_VERSION, create_ai_workflow


class ScriptBrief(serializers.Serializer):
    audience = serializers.CharField(max_length=500)
    goal = serializers.CharField(max_length=500)
    tone = serializers.CharField(max_length=80)
    product_facts = serializers.CharField(min_length=10, max_length=4000)
    language = serializers.CharField(max_length=40)
    duration_seconds = serializers.ChoiceField(choices=[15, 30, 45, 60])


class ScriptRequest(serializers.Serializer):
    request_id = serializers.UUIDField()
    snapshot_id = serializers.UUIDField()
    research_id = serializers.UUIDField()
    page_ids = serializers.ListField(child=serializers.UUIDField(), min_length=1, max_length=3)
    brief = ScriptBrief()
    facts_confirmed = serializers.BooleanField()
    provider = serializers.ChoiceField(choices=list(PROVIDERS))
    model = serializers.CharField(max_length=120)


def no_active(workspace):
    active = GenerationRun.objects.filter(
        workspace=workspace, workflow__status__in=["queued", "running", "canceling"]
    )
    for run in active:
        services.recover(run.workflow_id)
    if active.exists():
        raise ValidationError(
            "Script generation is already running. Wait or stop it before starting another."
        )


@api_view(["POST"])
def generate(request, workspace_id, app_id):
    workspace = workspace_access(request.user, workspace_id, write=True, module="studio")
    app = get_object_or_404(MobileApp, pk=app_id, workspace=workspace)
    payload = ScriptRequest(data=request.data)
    payload.is_valid(raise_exception=True)
    operation = json.loads(json.dumps(payload.validated_data, default=str))
    with transaction.atomic():
        Workspace.objects.select_for_update().get(pk=workspace.pk)
        workspace_access(request.user, workspace_id, write=True, module="studio")
        existing = GenerationRun.objects.filter(
            workspace=workspace, request_id=operation["request_id"]
        ).first()
        if existing:
            if existing.app_id != app.pk or existing.request != operation:
                return Response({"error": "This request ID has already been used."}, status=409)
            return Response(RunSerializer(existing).data)
        no_active(workspace)
        if not operation["facts_confirmed"]:
            raise ValidationError("Confirm the product facts before generating scripts.")
        snapshot = get_object_or_404(app.snapshots, pk=operation["snapshot_id"])
        research, sources = selected_sources(app, operation["research_id"], operation["page_ids"])
        connection = AIConnection.objects.filter(
            workspace=workspace, provider=operation["provider"]
        ).first()
        if not connection or operation["model"] not in [m["id"] for m in connection.model_catalog]:
            raise ValidationError(
                "Connect the provider and choose an available model in AI settings."
            )
        run = GenerationRun.objects.create(
            workspace=workspace,
            app=app,
            created_by=request.user,
            request_id=operation["request_id"],
            request=operation,
            provider=operation["provider"],
            inputs={
                "version": VERSION,
                "response_language": request.user.language,
                "snapshot_id": str(snapshot.pk),
                "app_context": snapshot.data.get("project", {}),
                "metadata": {
                    k: str(snapshot.data.get(k, ""))[:8000]
                    for k in ("name", "subtitle", "description", "category", "locale")
                },
                "brief": copy.deepcopy(operation["brief"]),
                "research_id": str(research.pk),
                "sources": sources,
                "facts_confirmed_at": timezone.now().isoformat(),
                "facts_confirmed_by": str(request.user.pk),
                "ai": {
                    "provider": connection.provider,
                    "model": operation["model"],
                    "connection_id": str(connection.pk),
                    "revision": str(connection.revision),
                },
            },
        )
        create_ai_workflow(run)
        transaction.on_commit(lambda: dispatch_generation(run))
    return Response(RunSerializer(run).data, status=202)


def retry_ai(request, workspace, original):
    payload = AIRetryRequest(data=request.data)
    payload.is_valid(raise_exception=True)
    services.recover(original.workflow_id)
    with transaction.atomic():
        Workspace.objects.select_for_update().get(pk=workspace.pk)
        workspace_access(request.user, workspace.pk, write=True, module="studio")
        previous = WorkflowRun.objects.select_for_update().get(pk=original.workflow_id)
        existing = GenerationRun.objects.filter(workflow__retry_of=previous).first()
        if existing:
            if not matches_retry_choice(
                existing.inputs.get("ai"), original.inputs.get("ai"), payload.validated_data
            ):
                return Response(
                    {
                        "error": "A retry already exists with a different AI choice. "
                        "Reload the latest attempt."
                    },
                    status=409,
                )
            return Response(RunSerializer(existing).data)
        if previous.status not in {"failed", "canceled"}:
            raise ValidationError("Only failed or canceled generations can be retried.")
        if original.review.get("rejected"):
            raise ValidationError(
                "The review rejected these scripts. Adjust the brief and start a new generation."
            )
        if previous.version != AI_VERSION or original.inputs["version"] != VERSION:
            raise ValidationError("The workflow changed. Start a new generation.")
        no_active(workspace)
        request_id = payload.validated_data["request_id"]
        if GenerationRun.objects.filter(workspace=workspace, request_id=request_id).exists():
            return Response({"error": "This request ID has already been used."}, status=409)
        inputs = copy.deepcopy(original.inputs)
        inputs["ai"] = retry_choice(workspace, inputs["ai"], payload.validated_data)
        changed = inputs["ai"] != original.inputs["ai"]
        run = GenerationRun.objects.create(
            workspace=workspace,
            app=original.app,
            created_by=request.user,
            request_id=request_id,
            request={"retry_of": str(original.pk)},
            provider=inputs["ai"]["provider"],
            inputs=inputs,
        )
        create_ai_workflow(run, retry_of=previous, reuse_steps={"context"} if changed else None)
        transaction.on_commit(lambda: dispatch_generation(run))
    return Response(RunSerializer(run).data, status=202)
