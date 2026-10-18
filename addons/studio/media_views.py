import hashlib
import re
import tempfile
from pathlib import Path

from django.db import transaction
from django.db.models import Sum
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, parser_classes
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from panda_store.core import images
from panda_store.core.access import workspace_access
from panda_store.core.models import Workspace

from . import media
from .models import SceneAsset, StoryboardRevision, VideoRender
from .scene_assets import MAX_ASSETS, representation
from .views import get_app

MAX_LIBRARY_BYTES = 200_000_000


def library_room(app, byte_size):
    used = app.scene_assets.aggregate(total=Sum("byte_size"))["total"] or 0
    if app.scene_assets.count() >= MAX_ASSETS or used + byte_size > MAX_LIBRARY_BYTES:
        raise ValidationError(
            "This app's library is full (60 files / 200 MB). Remove unused media first."
        )


def ranged_response(request, data, mime, filename=None):
    """Private byte ranges allow browser audio/video seeking without public media URLs."""
    size = len(data)
    start, end, status = 0, size - 1, 200
    value = request.headers.get("Range")
    if value:
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", value)
        try:
            if not match or not any(match.groups()):
                raise ValueError()
            first, last = match.groups()
            if first:
                start = int(first)
                end = min(int(last), size - 1) if last else size - 1
            else:
                start = max(0, size - int(last))
            if start > end or start >= size or (not first and int(last) == 0):
                raise ValueError()
        except ValueError:
            response = HttpResponse(status=416)
            response["Content-Range"] = f"bytes */{size}"
        else:
            status = 206
            response = HttpResponse(data[start : end + 1], status=status, content_type=mime)
            response["Content-Range"] = f"bytes {start}-{end}/{size}"
    else:
        response = HttpResponse(data, content_type=mime)
    response["Accept-Ranges"] = "bytes"
    response["Content-Length"] = len(response.content)
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    if filename:
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


@api_view(["POST"])
@parser_classes([MultiPartParser, FormParser])
def upload(request, workspace_id, app_id):
    app = get_app(request, workspace_id, app_id, write=True)
    file = request.FILES.get("file")
    if not file or not 0 < file.size <= media.MAX_UPLOAD:
        raise ValidationError("Choose one media file of at most 25 MB.")
    raw = file.read(media.MAX_UPLOAD + 1)
    fingerprint = hashlib.sha256(raw).hexdigest()
    key = hashlib.sha256(f"upload:{fingerprint}".encode()).hexdigest()
    existing = app.scene_assets.defer("data").filter(source_key=key).first()
    if existing:
        return Response(representation(existing))
    library_room(app, file.size)
    extension = Path(file.name).suffix.lower()
    try:
        if extension in {".png", ".jpg", ".jpeg", ".webp"}:
            raw, info = images.normalize(raw)
            info.update(kind="image", extension="jpg")
        elif extension in {".mp4", ".mp3", ".m4a", ".wav"}:
            with tempfile.TemporaryDirectory(prefix="panda-upload-") as temp:
                path = Path(temp) / ("input" + extension)
                path.write_bytes(raw)
                info = media.inspect(path)
        else:
            raise media.MediaError("Choose a PNG, JPEG, WebP, H.264 MP4, MP3, M4A or WAV file.")
    except (ValueError, media.MediaError) as exc:
        raise ValidationError(str(exc)) from None
    with transaction.atomic():
        Workspace.objects.select_for_update().get(pk=workspace_id)
        workspace_access(request.user, workspace_id, write=True, module="studio")
        existing = app.scene_assets.defer("data").filter(source_key=key).first()
        if existing:
            return Response(representation(existing))
        library_room(app, len(raw))
        asset = SceneAsset.objects.create(
            app=app,
            source_key=key,
            data=raw,
            byte_size=len(raw),
            metadata={
                **info,
                "sha256": hashlib.sha256(raw).hexdigest(),
                "name": Path(file.name).name[:200],
                "locale": "",
                "uploaded": True,
            },
        )
    return Response(representation(asset), status=201)


@api_view(["GET", "DELETE"])
def asset_file(request, workspace_id, asset_id):
    workspace = workspace_access(
        request.user, workspace_id, write=request.method == "DELETE", module="studio"
    )
    asset = get_object_or_404(SceneAsset, pk=asset_id, app__workspace=workspace)
    if request.method == "GET":
        return ranged_response(
            request, bytes(asset.data), asset.metadata.get("mime_type", "image/jpeg")
        )
    with transaction.atomic():
        Workspace.objects.select_for_update().get(pk=workspace.pk)
        workspace_access(request.user, workspace_id, write=True, module="studio")
        # Keep media referenced by saved versions; JSON scanning also works on SQLite.
        revisions = StoryboardRevision.objects.filter(
            board__creative__run__app_id=asset.app_id
        ).only("scenes")
        if any(
            str(asset.pk)
            in {
                row.get(field)
                for row in revision.scenes
                for field in ("asset_id", "audio_asset_id")
            }
            for revision in revisions.iterator()
        ):
            raise ValidationError(
                "A saved storyboard uses this file. Its revisions need the original media."
            )
        asset.delete()
    return Response(status=204)


@api_view(["GET"])
def capabilities(request, workspace_id):
    workspace_access(request.user, workspace_id, module="studio")
    return Response(
        {
            "available": media.available(),
            "width": media.WIDTH,
            "height": media.HEIGHT,
            "max_duration": media.MAX_DURATION,
            "max_upload_bytes": media.MAX_UPLOAD,
        }
    )


@api_view(["GET"])
def video(request, workspace_id, render_id):
    workspace = workspace_access(request.user, workspace_id, module="studio")
    render = get_object_or_404(
        VideoRender, pk=render_id, workspace=workspace, workflow__status="succeeded"
    )
    if render.data is None:
        raise ValidationError("This video is unavailable. Start a new render.")
    filename = (
        f"storyboard-v{render.revision.version}.mp4"
        if request.query_params.get("download") == "1"
        else None
    )
    return ranged_response(request, bytes(render.data), "video/mp4", filename)
