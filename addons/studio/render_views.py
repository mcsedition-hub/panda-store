import logging

from django.conf import settings
from django.db import transaction
from django.db.models import Sum
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from panda_store.core.access import workspace_access
from panda_store.core.models import Workspace
from panda_store.workflows import services

from . import media
from .models import RenderPart, SceneAsset, Storyboard, StoryboardRevision, VideoRender
from .storyboards import Conflict

logger = logging.getLogger(__name__)
VERSION = 1
MAX_RENDER_STORAGE = 500_000_000


class RenderRequest(serializers.Serializer):
    request_id = serializers.UUIDField()
    version = serializers.IntegerField(min_value=1)


def representation(render):
    return {
        "id": str(render.pk),
        "version": render.revision.version,
        "workflow_id": str(render.workflow_id),
        "status": render.workflow.status,
        "error": render.workflow.error,
        "created_at": render.created_at,
        "metadata": render.metadata,
        "can_delete": render.workflow.terminal and not render.retries.exists(),
        "url": f"/api/workspaces/{render.workspace_id}/studio/renders/{render.pk}/video/"
        if render.workflow.status == "succeeded"
        else None,
    }


def asset_ids(scenes):
    return {
        row.get(key) for row in scenes for key in ("asset_id", "audio_asset_id") if row.get(key)
    }


def validate_revision(revision):
    scenes = revision.scenes
    if sum(s["duration"] for s in scenes) > media.MAX_DURATION:
        raise ValidationError("Keep this first video export within 120 seconds.")
    assets = {
        str(a.pk): a
        for a in SceneAsset.objects.filter(
            app_id=revision.board.creative.run.app_id, pk__in=asset_ids(scenes)
        ).defer("data")
    }
    for scene in scenes:
        visual = assets.get(scene["asset_id"])
        if not visual or visual.metadata.get("kind") == "audio":
            raise ValidationError(
                f"Choose an image or recording for “{scene['title']}” before rendering."
            )
        meta = visual.metadata
        start = scene.get("video_start", 0)
        if meta.get("kind") == "video" and start + scene["duration"] > meta["duration"] + 0.05:
            raise ValidationError(
                f"“{scene['title']}” goes past the end of its recording. "
                "Adjust the start or duration."
            )
        audio_id = scene.get("audio_asset_id")
        if audio_id:
            audio = assets.get(audio_id)
            if not audio or audio.metadata.get("kind") != "audio":
                raise ValidationError("Choose voiceover audio from this app's library.")
            if scene.get("audio_start", 0) >= audio.metadata["duration"]:
                raise ValidationError(
                    f"The audio start for “{scene['title']}” is past the recording."
                )
        try:
            media.caption_lines(scene["caption"])
        except media.MediaError as exc:
            raise ValidationError(f"{scene['title']}: {exc}") from None
    return assets


def storage_room(workspace_id, additional=0):
    used = (
        VideoRender.objects.filter(workspace_id=workspace_id).aggregate(total=Sum("byte_size"))[
            "total"
        ]
        or 0
    ) + (
        RenderPart.objects.filter(render__workspace_id=workspace_id).aggregate(
            total=Sum("byte_size")
        )["total"]
        or 0
    )
    if used + additional > MAX_RENDER_STORAGE:
        raise media.MediaError(
            "Video storage is full (500 MB per workspace). Delete old renders and retry."
        )


def create_workflow(workspace, user, revision, retry_of=None):
    steps = [
        {
            "key": "validate",
            "title": "Check media and timing",
            "kind": "validation",
            "depends_on": [],
        }
    ]
    previous = "validate"
    for index, scene in enumerate(revision.scenes):
        key = f"shot_{index}"
        steps.append(
            {
                "key": key,
                "title": f"Render {scene['title']}"[:160],
                "kind": "media",
                "depends_on": [previous],
            }
        )
        previous = key
    steps.append(
        {
            "key": "assemble",
            "title": "Assemble and save MP4",
            "kind": "media",
            "depends_on": [previous],
        }
    )
    return services.create_run(
        workspace=workspace,
        user=user,
        module_id="studio",
        key="studio.video",
        version=VERSION,
        title=f"Render storyboard v{revision.version}",
        steps=steps,
        retry_of=retry_of,
    )


def dispatch(render):
    if settings.PANDA_WORKFLOW_DISPATCH == "database":
        return
    from .render_tasks import render_video

    try:
        render_video.delay(str(render.pk))
    except Exception:
        logger.exception("Could not queue video render %s", render.pk)
        services.fail(
            render.workflow_id, "The task service is unavailable. Start the worker and retry."
        )


def no_active(workspace):
    active = VideoRender.objects.filter(
        workspace=workspace, workflow__status__in=["queued", "running", "canceling"]
    )
    for render in active:
        services.recover(render.workflow_id)
    if active.exists():
        raise ValidationError(
            "A video is already rendering in this workspace. Wait or stop it first."
        )


@api_view(["GET", "POST"])
def renders(request, workspace_id, board_id):
    workspace = workspace_access(
        request.user, workspace_id, write=request.method == "POST", module="studio"
    )
    board = get_object_or_404(Storyboard, pk=board_id, creative__run__workspace=workspace)
    if request.method == "GET":
        recent = list(
            VideoRender.objects.filter(revision__board=board)
            .select_related("workflow", "revision")
            .defer("data")[:20]
        )
        for render in recent:
            if not render.workflow.terminal:
                services.recover(render.workflow_id)
                render.workflow.refresh_from_db()
        return Response([representation(render) for render in recent])
    payload = RenderRequest(data=request.data)
    payload.is_valid(raise_exception=True)
    values = payload.validated_data
    with transaction.atomic():
        Workspace.objects.select_for_update().get(pk=workspace.pk)
        workspace_access(request.user, workspace_id, write=True, module="studio")
        existing = VideoRender.objects.filter(
            workspace=workspace, request_id=values["request_id"]
        ).first()
        if existing:
            if (
                existing.revision.board_id != board.pk
                or existing.revision.version != values["version"]
                or existing.retry_of_id
            ):
                raise Conflict("This request ID has already been used.")
            return Response(representation(existing))
        no_active(workspace)
        revision = get_object_or_404(StoryboardRevision, board=board, version=values["version"])
        validate_revision(revision)
        workflow = create_workflow(workspace, request.user, revision)
        render = VideoRender.objects.create(
            workspace=workspace,
            revision=revision,
            workflow=workflow,
            request_id=values["request_id"],
        )
        transaction.on_commit(lambda: dispatch(render))
    return Response(representation(render), status=202)


@api_view(["POST"])
def retry(request, workspace_id, render_id):
    workspace = workspace_access(request.user, workspace_id, write=True, module="studio")
    original = get_object_or_404(VideoRender, pk=render_id, workspace=workspace)
    payload = RenderRequest(data=request.data)
    payload.is_valid(raise_exception=True)
    values = payload.validated_data
    services.recover(original.workflow_id)
    with transaction.atomic():
        Workspace.objects.select_for_update().get(pk=workspace.pk)
        workspace_access(request.user, workspace_id, write=True, module="studio")
        original.workflow.refresh_from_db()
        existing = VideoRender.objects.filter(
            workspace=workspace, request_id=values["request_id"]
        ).first()
        if existing:
            if (
                existing.retry_of_id != original.pk
                or existing.revision.version != values["version"]
            ):
                raise Conflict("This request ID has already been used.")
            return Response(representation(existing))
        existing = original.retries.first()
        if existing:
            return Response(representation(existing))
        if original.workflow.status not in {"failed", "canceled"}:
            raise ValidationError("Only interrupted renders can be retried.")
        if original.workflow.version != VERSION or values["version"] != original.revision.version:
            raise ValidationError("The render definition changed. Start a new render.")
        no_active(workspace)
        workflow = create_workflow(
            workspace, request.user, original.revision, retry_of=original.workflow
        )
        render = VideoRender.objects.create(
            workspace=workspace,
            revision=original.revision,
            workflow=workflow,
            retry_of=original,
            request_id=values["request_id"],
        )
        transaction.on_commit(lambda: dispatch(render))
    return Response(representation(render), status=202)


@api_view(["DELETE"])
def remove(request, workspace_id, render_id):
    workspace = workspace_access(request.user, workspace_id, write=True, module="studio")
    with transaction.atomic():
        Workspace.objects.select_for_update().get(pk=workspace.pk)
        workspace_access(request.user, workspace_id, write=True, module="studio")
        render = get_object_or_404(VideoRender, pk=render_id, workspace=workspace)
        services.recover(render.workflow_id)
        render.workflow.refresh_from_db()
        if not render.workflow.terminal or render.retries.exists():
            raise ValidationError(
                "Stop this render first, and remove any later retries before deleting it."
            )
        render.workflow.delete()
    return Response(status=204)
