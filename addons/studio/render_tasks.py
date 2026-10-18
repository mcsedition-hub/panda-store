import hashlib
import logging
import tempfile
import threading
from pathlib import Path

from celery import shared_task
from django.db import close_old_connections, connections, transaction
from rest_framework.exceptions import ValidationError

from panda_store.core.models import Workspace
from panda_store.workflows import services

from . import media
from .media import asset_suffix
from .models import RenderPart, VideoRender
from .render_views import storage_room, validate_revision

logger = logging.getLogger(__name__)


@shared_task(soft_time_limit=900, time_limit=930)
def render_video(render_id):
    render = VideoRender.objects.select_related("workflow", "revision__board__creative__run").get(
        pk=render_id
    )
    token = services.claim(render.workflow_id)
    if token is None:
        return
    stop = threading.Event()

    def heartbeat():
        try:
            while not stop.wait(5):
                close_old_connections()
                if not services.heartbeat(render.workflow_id, token):
                    stop.set()
        finally:
            connections.close_all()

    thread = threading.Thread(target=heartbeat, daemon=True)
    thread.start()

    def check():
        if stop.is_set():
            raise services.ExecutionStopped()

    def verified(data, expected):
        data = bytes(data)
        if hashlib.sha256(data).hexdigest() != expected:
            raise media.MediaError(
                "Saved media failed its integrity check. Start a new render with another file."
            )
        return data

    try:
        services.start_step(
            render.workflow_id, token, "validate", "Checking the frozen storyboard and app media."
        )
        if not media.available():
            raise media.MediaError("Install FFmpeg and ffprobe on the API and worker, then retry.")
        storage_room(render.workspace_id)
        assets = validate_revision(render.revision)
        if render.workflow.steps.get(key="validate").status != "succeeded":
            services.complete_step(
                render.workflow_id,
                token,
                "validate",
                "Media, captions and clip timing checked.",
                {"revision": render.revision.version},
            )
        parts = []
        for index, scene in enumerate(render.revision.scenes):
            key = f"shot_{index}"
            previous = services.start_step(
                render.workflow_id,
                token,
                key,
                f"Rendering {scene['title']} ({scene['duration']}s).",
            )
            if previous is not None:
                part = RenderPart.objects.get(
                    pk=previous["part_id"],
                    render__workspace_id=render.workspace_id,
                    render__revision_id=render.revision_id,
                )
                parts.append(verified(part.data, previous["sha256"]))
                continue
            with tempfile.TemporaryDirectory(prefix="panda-shot-") as temp:

                def materialize(asset_id):
                    if not asset_id:
                        return None
                    asset = assets[asset_id]
                    path = Path(temp) / (str(asset.pk) + "." + asset_suffix(asset))
                    path.write_bytes(verified(asset.data, asset.metadata["sha256"]))
                    return {**asset.metadata, "path": path}

                visual = materialize(scene["asset_id"])
                voice = materialize(scene.get("audio_asset_id"))
                data = media.encode_shot(temp, scene, visual, voice, check=check)
            with transaction.atomic():
                Workspace.objects.select_for_update().get(pk=render.workspace_id)
                with services.execution_lock(render.workflow_id, token):
                    storage_room(render.workspace_id, len(data))
                    part = RenderPart.objects.create(
                        render=render,
                        position=index,
                        data=data,
                        byte_size=len(data),
                        sha256=hashlib.sha256(data).hexdigest(),
                    )
                    services.complete_step(
                        render.workflow_id,
                        token,
                        key,
                        f"{scene['title']} rendered and saved.",
                        {"part_id": part.pk, "sha256": part.sha256},
                    )
            parts.append(data)
        services.start_step(
            render.workflow_id,
            token,
            "assemble",
            "Joining the saved shots and checking the final MP4.",
        )
        with tempfile.TemporaryDirectory(prefix="panda-assemble-") as temp:
            data, info = media.assemble(
                temp, parts, sum(s["duration"] for s in render.revision.scenes), check=check
            )
        with transaction.atomic():
            Workspace.objects.select_for_update().get(pk=render.workspace_id)
            with services.execution_lock(render.workflow_id, token):
                storage_room(render.workspace_id, len(data))
                render.data, render.metadata, render.byte_size = data, info, len(data)
                render.save(update_fields=["data", "metadata", "byte_size"])
                services.complete_step(
                    render.workflow_id,
                    token,
                    "assemble",
                    "MP4 checked and saved privately.",
                    {"sha256": info["sha256"]},
                )
                services.succeed(render.workflow_id, token, "Video ready to preview and download.")
    except services.ExecutionStopped:
        services.fail(
            render.workflow_id, "Rendering stopped. Saved shots can be reused on retry.", token
        )
    except (media.MediaError, ValidationError) as exc:
        message = (
            " ".join(str(item) for item in exc.detail)
            if isinstance(exc, ValidationError) and isinstance(exc.detail, list)
            else str(exc)
        )
        services.fail(render.workflow_id, message[:300], token)
    except Exception:
        logger.exception("Video rendering failed for %s", render.pk)
        services.fail(
            render.workflow_id,
            "Video rendering failed. Check the worker and retry; saved shots are retained.",
            token,
        )
    finally:
        stop.set()
        thread.join(timeout=2)
