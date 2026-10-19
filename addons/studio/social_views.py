import base64
import copy
import io
import json
import zipfile
from pathlib import Path

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from addons.app_catalog.models import MobileApp
from panda_store.ai.providers import PROVIDERS, ProviderError, check_capabilities
from panda_store.ai.retries import AIRetryRequest, matches_retry_choice, retry_choice
from panda_store.core.access import workspace_access
from panda_store.core.models import AIConnection, Workspace
from panda_store.workflows import services

from .creative_ai import VERSION
from .creative_views import ScriptBrief, no_active
from .models import GenerationRun, SocialPost, SocialResearch
from .serializers import RunSerializer
from .social_evidence import PLATFORMS, post_url, qualify, validate_capture
from .views import dispatch_generation
from .workflow import create_ai_workflow


class ResearchBrief(ScriptBrief):
    audience = serializers.CharField(max_length=500, allow_blank=True, default="")
    product_facts = serializers.CharField(
        min_length=10, max_length=4000, allow_blank=True, default=""
    )


class Start(serializers.Serializer):
    request_id = serializers.UUIDField()
    snapshot_id = serializers.UUIDField()
    topic = serializers.CharField(min_length=5, max_length=500)
    market = serializers.CharField(max_length=100)
    platforms = serializers.ListField(
        child=serializers.ChoiceField(choices=PLATFORMS), min_length=1, max_length=4
    )
    min_views = serializers.IntegerField(min_value=100, max_value=1000000000)
    min_likes = serializers.IntegerField(min_value=10, max_value=100000000)
    brief = ResearchBrief()
    context_mode = serializers.ChoiceField(choices=["app", "manual"], default="manual")
    facts_confirmed = serializers.BooleanField(default=False)
    provider = serializers.ChoiceField(choices=list(PROVIDERS))
    model = serializers.CharField(max_length=120)

    def validate(self, attrs):
        if attrs["context_mode"] == "manual":
            brief = ScriptBrief(data=attrs["brief"])
            brief.is_valid(raise_exception=True)
        return attrs


def app_product_facts(data):
    """Use the saved source verbatim, including restrictions and planned scope."""
    project = data.get("project") or {}
    if project:
        return project.get("specification", "").strip()
    parts = [
        data.get(field, "")
        for field in ("subtitle", "short_description", "description", "promotional_text")
    ] + (data.get("features") or [])
    content = "\n\n".join(
        dict.fromkeys(p.strip() for p in parts if isinstance(p, str) and p.strip())
    )
    return "\n\n".join(filter(None, [data.get("name", ""), content])) if len(content) >= 10 else ""


class Adapt(serializers.Serializer):
    request_id = serializers.UUIDField()
    post_ids = serializers.ListField(child=serializers.UUIDField(), min_length=1, max_length=3)


def connection(workspace, provider, model):
    item = AIConnection.objects.filter(workspace=workspace, provider=provider).first()
    if not item or model not in [m["id"] for m in item.model_catalog]:
        raise ValidationError("Connect an AI provider and choose an available model.")
    try:
        check_capabilities(provider, model, images=True)
    except ProviderError as exc:
        raise ValidationError(str(exc)) from None
    return {
        "provider": provider,
        "model": model,
        "connection_id": str(item.pk),
        "revision": str(item.revision),
    }


def event(session, message, url=""):
    session.events = (
        session.events + [{"at": timezone.now().isoformat(), "message": message, "url": url}]
    )[-150:]


def serialize_post(post):
    return {
        "id": str(post.pk),
        "research_id": str(post.research_id),
        "url": post.url,
        "evidence": post.evidence,
        "metrics": post.metrics,
        "qualification": post.qualification,
        "analysis": post.analysis,
        "captured_at": post.captured_at,
        "frame_count": len(post.frames),
    }


def compatible_posts(session):
    """Reuse relevance only when the app and confirmed research context still match."""
    inputs = session.inputs
    audience = Q(research__inputs__brief__audience=inputs["brief"]["audience"])
    if (
        inputs.get("context_mode") == "app"
        and inputs.get("context_origin", {}).get("audience") == "ai"
    ):
        # Generated wording is not a stable context identifier. Reuse only when
        # both audiences came from the same app facts, topic, market and language.
        # Manual targeting and genuinely different contexts still require an exact match.
        audience |= Q(
            research__inputs__context_mode="app",
            research__inputs__context_origin__audience="ai",
            research__inputs__topic=inputs["topic"],
            research__inputs__brief__language=inputs["brief"]["language"],
        )
    return SocialPost.objects.filter(
        audience,
        research__workspace_id=session.workspace_id,
        research__app_id=session.app_id,
        research__status="completed",
        research__inputs__facts_confirmed=True,
        research__inputs__snapshot_id=inputs["snapshot_id"],
        research__inputs__market=inputs["market"],
        research__inputs__brief__product_facts=inputs["brief"]["product_facts"],
        qualification__status="qualified",
    ).select_related("research")


def passes_current_filters(post, session):
    return (
        post.analysis.get("relevant") is True
        and post.analysis.get("review", {}).get("supported") is True
        and qualify(
            post.evidence,
            post.metrics,
            {k: session.inputs[k] for k in ("min_views", "min_likes")},
            content_format=post.analysis.get("format"),
        )["status"]
        == "metrics_pass"
    )


def serialize(session, details=True):
    status, error = session.status, ""
    if session.workflow and status in {"planning", "analyzing"}:
        services.recover(session.workflow_id)
        session.workflow.refresh_from_db()
        if session.workflow.status in {"failed", "canceled"}:
            status, error = session.workflow.status, session.workflow.error
    data = {
        "id": str(session.pk),
        "status": status,
        "error": error,
        "created_at": session.created_at,
        "topic": session.inputs["topic"],
        "workflow_id": str(session.workflow_id),
        "plan": session.plan,
        "inputs": session.inputs,
        "events": session.events,
    }
    if details:
        data["posts"] = [serialize_post(p) for p in session.posts.all()]
    return data


@api_view(["GET"])
def references(request, workspace_id, session_id):
    workspace = workspace_access(request.user, workspace_id, module="studio")
    session = get_object_or_404(SocialResearch, pk=session_id, workspace=workspace)
    if session.status != "completed":
        return Response({"posts": []})
    # A repeated capture is one reference, even when several sessions found it.
    seen = set(session.posts.values_list("url", flat=True))
    posts = []
    for post in compatible_posts(session).exclude(research=session).order_by("-captured_at"):
        if post.url in seen or not passes_current_filters(post, session):
            continue
        seen.add(post.url)
        posts.append({**serialize_post(post), "research_topic": post.research.inputs["topic"]})
    return Response({"posts": posts})


def launch(session, user, kind):
    from .social_tasks import dispatch

    title = "Plan social research" if kind == "plan" else "Analyze social references"
    workflow = services.create_run(
        workspace=session.workspace,
        user=user,
        module_id="studio",
        key="studio.social",
        version=1,
        title=title,
        steps=[{"key": kind, "title": title, "kind": "ai", "depends_on": []}],
    )
    session.workflow = workflow
    session.status = "planning" if kind == "plan" else "analyzing"
    session.save()
    transaction.on_commit(lambda: dispatch(workflow.pk))


def fork_research(session, user, choice, request_id):
    """Keep the old analysis and reuse only the observed evidence for a new AI choice."""
    inputs = copy.deepcopy(session.inputs)
    inputs["ai"] = choice
    inputs["retry_operation_id"] = inputs.get("retry_operation_id", str(session.pk))
    fork = SocialResearch.objects.create(
        workspace=session.workspace,
        app=session.app,
        created_by=user,
        request_id=request_id,
        request={"retry_of": str(session.pk)},
        inputs=inputs,
        plan=copy.deepcopy(session.plan),
        events=copy.deepcopy(session.events),
    )
    thresholds = {k: inputs[k] for k in ("min_views", "min_likes")}
    for post in session.posts.all():
        saved = SocialPost.objects.create(
            research=fork,
            url=post.url,
            evidence=post.evidence,
            frames=post.frames,
            metrics=post.metrics,
            qualification=qualify(post.evidence, post.metrics, thresholds),
        )
        # auto_now_add must not make a retained capture look newly observed.
        SocialPost.objects.filter(pk=saved.pk).update(captured_at=post.captured_at)
    event(fork, "AI choice changed for this retry. Saved captures retained; analysis restarts.")
    return fork


def adaptation_brief(inputs, language):
    brief = copy.deepcopy(inputs["brief"])
    # Earlier browser searches automatically selected concept feedback for every
    # project. New adaptations use launch copy without rewriting saved research.
    if inputs.get("app_context", {}).get("origin") == "project" and brief["goal"] in {
        "Present the unpublished concept and gather feedback.",
        "Present the concept and gather feedback.",
        "Présenter le concept et recueillir des retours.",
    }:
        brief["goal"] = (
            "Donner envie d’essayer l’application."
            if language == "fr"
            else "Encourage people to try the app."
        )
    return brief


@api_view(["GET", "POST"])
def sessions(request, workspace_id, app_id):
    workspace = workspace_access(
        request.user, workspace_id, module="studio", write=request.method == "POST"
    )
    app = get_object_or_404(MobileApp, pk=app_id, workspace=workspace)
    if request.method == "GET":
        return Response(
            [serialize(s, False) for s in app.social_research.select_related("workflow")[:20]]
        )
    payload = Start(data=request.data)
    payload.is_valid(raise_exception=True)
    operation = json.loads(json.dumps(payload.validated_data, default=str))
    if operation["context_mode"] == "manual" and not operation["facts_confirmed"]:
        raise ValidationError("Confirm the app's product facts before starting research.")
    with transaction.atomic():
        Workspace.objects.select_for_update().get(pk=workspace.pk)
        workspace_access(request.user, workspace_id, write=True, module="studio")
        existing = SocialResearch.objects.filter(
            workspace=workspace, request_id=operation["request_id"]
        ).first()
        if existing:
            previous_request = {
                "context_mode": "manual",
                "facts_confirmed": False,
                **existing.request,
            }
            if existing.app_id != app.pk or previous_request != operation:
                return Response({"error": "Request ID already used."}, status=409)
            return Response(serialize(existing))
        snapshot = get_object_or_404(app.snapshots, pk=operation["snapshot_id"])
        ai = connection(workspace, operation["provider"], operation["model"])
        brief = copy.deepcopy(operation["brief"])
        automatic = operation["context_mode"] == "app"
        if automatic and not brief["product_facts"]:
            brief["product_facts"] = app_product_facts(snapshot.data)
            if len(brief["product_facts"]) < 10:
                raise ValidationError("Add an app description in My apps before starting research.")
        session = SocialResearch.objects.create(
            workspace=workspace,
            app=app,
            request_id=operation["request_id"],
            request=operation,
            created_by=request.user,
            inputs={
                **operation,
                "brief": brief,
                "facts_confirmed": True,
                "context_origin": {
                    "product_facts": "snapshot"
                    if automatic and not operation["brief"]["product_facts"]
                    else "user",
                    "audience": "user" if brief["audience"] else "pending",
                },
                "app_context": snapshot.data.get("project", {}),
                "response_language": request.user.language,
                "metadata": {
                    k: str(snapshot.data.get(k, ""))[:8000]
                    for k in (
                        "name",
                        "subtitle",
                        "short_description",
                        "description",
                        "category",
                        "audience",
                        "locale",
                        "platform",
                    )
                },
                "ai": ai,
                "facts_confirmed_at": timezone.now().isoformat(),
            },
        )
        launch(session, request.user, "plan")
    return Response(serialize(session), status=202)


@api_view(["GET", "POST"])
def detail(request, workspace_id, session_id):
    workspace = workspace_access(
        request.user, workspace_id, module="studio", write=request.method == "POST"
    )
    session = get_object_or_404(
        SocialResearch.objects.select_related("workflow"), pk=session_id, workspace=workspace
    )
    if request.method == "GET":
        return Response(serialize(session))
    with transaction.atomic():
        Workspace.objects.select_for_update().get(pk=workspace.pk)
        workspace_access(request.user, workspace_id, write=True, module="studio")
        session = SocialResearch.objects.select_for_update().get(pk=session.pk)
        action = request.data.get("action")
        if action == "stop":
            if session.workflow_id and session.status in {"planning", "analyzing"}:
                services.cancel(session.workflow_id)
            session.status = "stopped"
            event(session, "Research stopped. Collected evidence is retained.")
        elif action == "browse":
            if session.status not in {"ready", "collecting", "stopped"} or not session.plan:
                raise ValidationError("Wait for the search plan before opening the browser.")
            session.status = "collecting"
            event(session, "Browser collection started or resumed.")
        elif action == "finish":
            if session.status == "analyzing" or session.status == "completed":
                return Response(serialize(session))
            if session.status not in {"collecting", "stopped"} or not session.posts.exists():
                raise ValidationError("Collect at least one post before analyzing references.")
            launch(session, request.user, "analyze")
        elif action == "retry":
            values = {}
            if "provider" in request.data or "model" in request.data:
                payload = AIRetryRequest(data=request.data)
                payload.is_valid(raise_exception=True)
                values = payload.validated_data
            existing = SocialResearch.objects.filter(
                workspace=workspace, request__retry_of=str(session.pk)
            ).first()
            if existing:
                if not matches_retry_choice(existing.inputs["ai"], session.inputs["ai"], values):
                    return Response(
                        {
                            "error": "A retry already exists with a different AI choice. "
                            "Reload the latest attempt."
                        },
                        status=409,
                    )
                return Response(serialize(existing))
            if session.workflow_id:
                services.recover(session.workflow_id)
                session.workflow.refresh_from_db()
                if not session.workflow.terminal:
                    raise ValidationError("Wait for the current task to stop before retrying.")
            if session.status == "completed":
                raise ValidationError("This research is already complete.")
            choice = retry_choice(workspace, session.inputs["ai"], values, images=True)
            if choice != session.inputs["ai"]:
                if SocialResearch.objects.filter(
                    workspace=workspace, request_id=values["request_id"]
                ).exists():
                    return Response({"error": "Request ID already used."}, status=409)
                session = fork_research(session, request.user, choice, values["request_id"])
            launch(session, request.user, "analyze" if session.posts.exists() else "plan")
        elif action == "event":
            if session.status != "collecting":
                raise ValidationError("This browser session is not collecting.")
            message = request.data.get("message")
            if not isinstance(message, str) or not 1 <= len(message) <= 500:
                raise ValidationError("Invalid browser activity.")
            source_url = request.data.get("url", "")
            if not isinstance(source_url, str) or len(source_url) > 2048:
                raise ValidationError("Invalid browser activity.")
            event(session, message, post_url(source_url)[1] if source_url else "")
        else:
            raise ValidationError("Unknown research action.")
        session.save()
    return Response(serialize(session))


@api_view(["POST"])
def capture(request, workspace_id, session_id):
    workspace = workspace_access(request.user, workspace_id, write=True, module="studio")
    evidence, metrics, frames = validate_capture(request.data)
    with transaction.atomic():
        Workspace.objects.select_for_update().get(pk=workspace.pk)
        workspace_access(request.user, workspace_id, write=True, module="studio")
        session = get_object_or_404(
            SocialResearch.objects.select_for_update(), pk=session_id, workspace=workspace
        )
        if session.status != "collecting":
            raise ValidationError("This session is not accepting browser captures.")
        if not session.posts.filter(url=evidence["url"]).exists():
            if session.posts.count() >= 12:
                raise ValidationError("This session already contains 12 posts. Start a new search.")
            thresholds = {k: session.inputs[k] for k in ("min_views", "min_likes")}
            SocialPost.objects.create(
                research=session,
                url=evidence["url"],
                evidence=evidence,
                metrics=metrics,
                frames=frames,
                qualification=qualify(evidence, metrics, thresholds),
            )
            event(session, "Post captured with observed counters and coverage.", evidence["url"])
            session.save()
    return Response(serialize(session))


@api_view(["POST"])
def adapt(request, workspace_id, session_id):
    workspace = workspace_access(request.user, workspace_id, write=True, module="studio")
    payload = Adapt(data=request.data)
    payload.is_valid(raise_exception=True)
    operation = json.loads(json.dumps(payload.validated_data, default=str))
    operation["social_research_id"] = str(session_id)
    with transaction.atomic():
        Workspace.objects.select_for_update().get(pk=workspace.pk)
        workspace_access(request.user, workspace_id, write=True, module="studio")
        session = get_object_or_404(SocialResearch, pk=session_id, workspace=workspace)
        old = GenerationRun.objects.filter(
            workspace=workspace, request_id=operation["request_id"]
        ).first()
        if old:
            if old.request != operation or old.app_id != session.app_id:
                return Response({"error": "Request ID already used."}, status=409)
            return Response(RunSerializer(old).data)
        count = len(operation["post_ids"])
        if session.status != "completed" or len(set(operation["post_ids"])) != count:
            raise ValidationError(
                "Select one to three distinct qualified posts from completed research."
            )
        posts = {
            str(p.pk): p for p in compatible_posts(session).filter(pk__in=operation["post_ids"])
        }
        current_urls = set(session.posts.values_list("url", flat=True))
        if (
            len(posts) != count
            or len({p.url for p in posts.values()}) != count
            or any(
                not passes_current_filters(p, session)
                or (p.research_id != session.pk and p.url in current_urls)
                for p in posts.values()
            )
        ):
            raise ValidationError(
                "Choose one to three different qualified posts for this app, with matching "
                "confirmed features, audience, market and app import. "
                "Current performance filters apply."
            )
        no_active(workspace)
        sources = [
            {
                "page_id": str(p.pk),
                "research_id": str(p.research_id),
                "research_topic": p.research.inputs["topic"],
                "platform": p.evidence["platform"],
                "url": p.url,
                "title": p.evidence["title"],
                "captured_at": p.captured_at.isoformat(),
                "kind": "social_post",
                "finding": p.analysis,
                "format": p.analysis["format"],
                "metrics": p.metrics,
                "qualification": p.qualification,
                "coverage": p.evidence["coverage"],
            }
            for p in (posts[i] for i in operation["post_ids"])
        ]
        run = GenerationRun.objects.create(
            workspace=workspace,
            app=session.app,
            request_id=operation["request_id"],
            request=operation,
            created_by=request.user,
            provider=session.inputs["ai"]["provider"],
            inputs={
                "version": VERSION,
                "response_language": request.user.language,
                "mode": "smm",
                "app_context": session.inputs.get("app_context", {}),
                "context_origin": session.inputs.get("context_origin", {}),
                "snapshot_id": session.inputs["snapshot_id"],
                "metadata": session.inputs["metadata"],
                "brief": adaptation_brief(session.inputs, request.user.language),
                "research_id": str(session.pk),
                "sources": sources,
                "facts_confirmed_at": session.inputs["facts_confirmed_at"],
                "facts_confirmed_by": str(session.created_by_id),
                "ai": session.inputs["ai"],
            },
        )
        create_ai_workflow(run)
        transaction.on_commit(lambda: dispatch_generation(run))
    return Response(RunSerializer(run).data, status=202)


@api_view(["GET"])
def extension(request, workspace_id):
    workspace_access(request.user, workspace_id, module="studio")
    root = Path(settings.BASE_DIR) / "addons/studio/browser_extension"
    result = io.BytesIO()
    with zipfile.ZipFile(result, "w", zipfile.ZIP_DEFLATED) as bundle:
        for path in sorted(root.iterdir()):
            if path.suffix in {".json", ".js", ".md"}:
                bundle.writestr("panda-smm/" + path.name, path.read_bytes())
    response = HttpResponse(result.getvalue(), content_type="application/zip")
    response["Content-Disposition"] = 'attachment; filename="panda-smm-browser.zip"'
    return response


@api_view(["GET"])
def frame(request, workspace_id, post_id, position):
    workspace = workspace_access(request.user, workspace_id, module="studio")
    post = get_object_or_404(SocialPost, pk=post_id, research__workspace=workspace)
    if position < 0 or position >= len(post.frames):
        return Response({"error": "Frame not found."}, status=404)
    response = HttpResponse(base64.b64decode(post.frames[position]), content_type="image/jpeg")
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response
