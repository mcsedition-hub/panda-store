import copy
import json
import logging
import uuid

from django.conf import settings
from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from addons.app_catalog.models import MobileApp
from panda_store.ai.providers import PROVIDERS, ProviderError, check_capabilities
from panda_store.core.access import workspace_access
from panda_store.core.models import AIConnection, Workspace
from panda_store.workflows import services
from panda_store.workflows.models import WorkflowRun

from .models import ResearchPage, ResearchRun
from .research_search import REFERENCES, VERSION
from .research_tasks import browser_ready, research
from .workflow import RESEARCH_STEPS, RESEARCH_VERSION

logger = logging.getLogger(__name__)


class StartRequest(serializers.Serializer):
    request_id = serializers.UUIDField()
    snapshot_id = serializers.UUIDField()
    topic = serializers.CharField(min_length=5, max_length=500)
    market = serializers.CharField(max_length=100)
    provider = serializers.ChoiceField(choices=list(PROVIDERS))
    model = serializers.CharField(max_length=120)


class RetryRequest(serializers.Serializer):
    request_id = serializers.UUIDField()


def serialize(run, details=False):
    data = {
        "id": str(run.pk),
        "workflow_id": str(run.workflow_id),
        "status": run.workflow.status,
        "error": run.workflow.error,
        "created_at": run.created_at,
        "topic": run.inputs["topic"],
        "market": run.inputs["market"],
        "snapshot_id": run.inputs["snapshot_id"],
        "ai": {k: run.inputs["ai"][k] for k in ("provider", "model")},
    }
    if details:
        root = run.evidence_root or run
        data["pages"] = [
            page_summary(p) for p in root.pages.defer("top_image", "scroll_image").all()
        ]
        data["report"] = run.report
        discovery = run.workflow.steps.filter(key="discover", status="succeeded").first()
        data["discovery"] = discovery.output if discovery else None
    return data


def page_summary(page):
    base = f"/api/workspaces/{page.run.workspace_id}/studio/research-pages/{page.pk}/"
    return {
        "id": str(page.pk),
        "source": page.source,
        "final_url": page.final_url,
        "title": page.title,
        "status": page.status,
        "reason": page.reason,
        "text": page.text,
        "trace": page.trace,
        "hashes": page.hashes,
        "captured_at": page.captured_at,
        "images": {
            frame: base + frame + "/" for frame in ("top", "scroll") if frame in page.hashes
        },
    }


def create(workspace, user, *, retry_of=None, refresh_pages=False):
    return services.create_run(
        workspace=workspace,
        user=user,
        module_id="studio",
        key="studio.research",
        version=RESEARCH_VERSION,
        title="Research creative examples",
        steps=RESEARCH_STEPS,
        retry_of=retry_of,
        reuse_steps={"context", "discover"} if refresh_pages else None,
    )


def dispatch(workflow_id):
    if settings.PANDA_WORKFLOW_DISPATCH == "database":
        return
    try:
        research.delay(str(workflow_id))
    except Exception:
        logger.exception("Could not enqueue research %s", workflow_id)
        services.fail(workflow_id, "The task service is unavailable. Start the worker and retry.")


def no_active(workspace):
    active = ResearchRun.objects.filter(
        workspace=workspace, workflow__status__in=["queued", "running", "canceling"]
    )
    for run in active:
        services.recover(run.workflow_id)
    if active.exists():
        raise ValidationError(
            "Research is already running in this workspace. "
            "Wait or stop it before starting another session."
        )


@api_view(["GET"])
def capabilities(request, workspace_id):
    workspace_access(request.user, workspace_id, module="studio")
    return Response(
        {
            "browser_installed": browser_ready(),
            "max_discovered_pages": 6,
            "reference_pages": 3,
            "max_model_calls": 3,
        }
    )


@api_view(["GET", "POST"])
def runs(request, workspace_id, app_id):
    workspace = workspace_access(
        request.user, workspace_id, write=request.method == "POST", module="studio"
    )
    app = get_object_or_404(MobileApp, workspace=workspace, pk=app_id)
    if request.method == "GET":
        recent = list(app.research_runs.select_related("workflow")[:30])
        for run in recent:
            if not run.workflow.terminal:
                services.recover(run.workflow_id)
                run.workflow.refresh_from_db()
        return Response([serialize(run) for run in recent])
    payload = StartRequest(data=request.data)
    payload.is_valid(raise_exception=True)
    values = payload.validated_data
    operation = json.loads(json.dumps(values, default=str))
    with transaction.atomic():
        Workspace.objects.select_for_update().get(pk=workspace.pk)
        workspace_access(request.user, workspace_id, write=True, module="studio")
        existing = (
            ResearchRun.objects.filter(workspace=workspace, request_id=values["request_id"])
            .select_related("workflow")
            .first()
        )
        if existing:
            if existing.app_id != app.pk or existing.request != operation:
                return Response({"error": "This request ID has already been used."}, status=409)
            return Response(serialize(existing))
        no_active(workspace)
        try:
            check_capabilities(values["provider"], values["model"], web_search=True)
        except ProviderError as exc:
            raise ValidationError(str(exc)) from None
        if not browser_ready():
            raise ValidationError(
                "Install Chromium on the worker: python -m playwright install chromium."
            )
        snapshot = get_object_or_404(app.snapshots, pk=values["snapshot_id"])
        connection = AIConnection.objects.filter(
            workspace=workspace, provider=values["provider"]
        ).first()
        if not connection or values["model"] not in [m["id"] for m in connection.model_catalog]:
            raise ValidationError(
                "Connect this provider and choose an available model in AI settings."
            )
        inputs = {
            "version": VERSION,
            "response_language": request.user.language,
            "snapshot_id": str(snapshot.pk),
            "app_context": snapshot.data.get("project", {}),
            "captured_at": snapshot.captured_at.isoformat(),
            "topic": values["topic"],
            "market": values["market"],
            "app": {
                k: str(snapshot.data.get(k, ""))[:8000]
                for k in ("name", "subtitle", "description", "category", "locale")
            },
            "ai": {
                "provider": connection.provider,
                "model": values["model"],
                "connection_id": str(connection.pk),
                "revision": str(connection.revision),
            },
            "references": copy.deepcopy(REFERENCES),
        }
        workflow = create(workspace, request.user)
        run = ResearchRun.objects.create(
            workspace=workspace,
            app=app,
            workflow=workflow,
            request_id=values["request_id"],
            request=operation,
            inputs=inputs,
        )
        transaction.on_commit(lambda: dispatch(workflow.pk))
    return Response(serialize(run), status=202)


@api_view(["GET"])
def detail(request, workspace_id, run_id):
    workspace = workspace_access(request.user, workspace_id, module="studio")
    run = get_object_or_404(
        ResearchRun.objects.select_related("workflow", "evidence_root"),
        workspace=workspace,
        pk=run_id,
    )
    if not run.workflow.terminal:
        services.recover(run.workflow_id)
        run.workflow.refresh_from_db()
    return Response(serialize(run, details=True))


@api_view(["POST"])
def retry(request, workspace_id, run_id):
    workspace = workspace_access(request.user, workspace_id, write=True, module="studio")
    payload = RetryRequest(data=request.data)
    payload.is_valid(raise_exception=True)
    original = get_object_or_404(ResearchRun, workspace=workspace, pk=run_id)
    services.recover(original.workflow_id)
    with transaction.atomic():
        Workspace.objects.select_for_update().get(pk=workspace.pk)
        workspace_access(request.user, workspace_id, write=True, module="studio")
        previous = WorkflowRun.objects.select_for_update().get(pk=original.workflow_id)
        existing = (
            ResearchRun.objects.filter(workflow__retry_of=previous)
            .select_related("workflow")
            .first()
        )
        if existing:
            return Response(serialize(existing))
        refresh_pages = previous.status == "succeeded"
        root = original.evidence_root or original
        if previous.status not in {"failed", "canceled"} and not (
            refresh_pages and root.pages.filter(status="unavailable").exists()
        ):
            raise ValidationError("Only failed or canceled research can be retried.")
        if previous.version != RESEARCH_VERSION or original.inputs["version"] != VERSION:
            raise ValidationError("The research workflow changed. Start new research.")
        no_active(workspace)
        request_id = payload.validated_data["request_id"]
        if ResearchRun.objects.filter(workspace=workspace, request_id=request_id).exists():
            return Response({"error": "This request ID has already been used."}, status=409)
        workflow = create(workspace, request.user, retry_of=previous, refresh_pages=refresh_pages)
        run = ResearchRun.objects.create(
            workspace=workspace,
            app=original.app,
            workflow=workflow,
            request_id=request_id,
            request={"retry_of": str(original.pk)},
            inputs=original.inputs,
            evidence_root=None if refresh_pages else root,
        )
        if refresh_pages:
            for page in root.pages.filter(status="observed"):
                captured_at = page.captured_at
                page.source = {**page.source, "reused_from": str(page.pk)}
                page.pk = uuid.uuid4()
                page.run = run
                page.save(force_insert=True)
                ResearchPage.objects.filter(pk=page.pk).update(captured_at=captured_at)
        transaction.on_commit(lambda: dispatch(workflow.pk))
    return Response(serialize(run), status=202)


@api_view(["GET"])
def image(request, workspace_id, page_id, frame):
    workspace = workspace_access(request.user, workspace_id, module="studio")
    if frame not in {"top", "scroll"}:
        raise ValidationError("Choose a saved page frame.")
    page = get_object_or_404(ResearchPage, pk=page_id, run__workspace=workspace)
    data = getattr(page, frame + "_image")
    if not data:
        return Response({"error": "This frame is unavailable."}, status=404)
    response = HttpResponse(bytes(data), content_type="image/jpeg")
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response
