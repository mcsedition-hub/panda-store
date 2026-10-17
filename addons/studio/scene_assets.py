"""The connected app's own screenshots, archived independently of ASO activation."""

import asyncio
import hashlib

import httpx
from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from panda_store.core import images
from panda_store.core.access import workspace_access
from panda_store.core.models import Workspace

from .models import SceneAsset
from .views import get_app

MAX_ASSETS = 60


def source_key(snapshot_id, position):
    return hashlib.sha256(f"{snapshot_id}:{position}".encode()).hexdigest()


def representation(asset):
    return {
        "id": str(asset.pk),
        **asset.metadata,
        "url": f"/api/workspaces/{asset.app.workspace_id}/studio/scene-assets/{asset.pk}/image/",
    }


class ImportInput(serializers.Serializer):
    snapshot_id = serializers.UUIDField()
    position = serializers.IntegerField(min_value=0, max_value=99)


@api_view(["GET", "POST"])
def assets(request, workspace_id, app_id):
    app = get_app(request, workspace_id, app_id, write=request.method == "POST")
    if request.method == "GET":
        snapshot = app.snapshots.first()
        saved = list(app.scene_assets.select_related("app").defer("data"))
        by_source = {asset.source_key: str(asset.pk) for asset in saved}
        candidates = []
        for position, shot in enumerate(
            snapshot.data.get("screenshots", [])[:100] if snapshot else []
        ):
            if not isinstance(shot, dict) or not images.allowed_url(shot.get("url")):
                continue
            candidates.append(
                {
                    "snapshot_id": str(snapshot.pk),
                    "position": position,
                    "name": shot.get("name", "") or f"Store screenshot {position + 1}",
                    "preview_url": shot["url"],
                    "asset_id": by_source.get(source_key(snapshot.pk, position)),
                }
            )
        return Response({"assets": [representation(a) for a in saved], "candidates": candidates})
    serializer = ImportInput(data=request.data)
    serializer.is_valid(raise_exception=True)
    values = serializer.validated_data
    key = source_key(values["snapshot_id"], values["position"])
    existing = app.scene_assets.defer("data").filter(source_key=key).first()
    if existing:
        return Response(representation(existing))
    snapshot = get_object_or_404(app.snapshots, pk=values["snapshot_id"])
    shots = snapshot.data.get("screenshots", [])
    if values["position"] >= len(shots):
        raise ValidationError("This screenshot is unavailable. Refresh the app import.")
    shot = shots[values["position"]]
    if not isinstance(shot, dict):
        raise ValidationError("This screenshot is unavailable. Refresh the app import.")
    if app.scene_assets.count() >= MAX_ASSETS:
        raise ValidationError("This app's library has reached its 60-image limit.")
    try:
        raw = asyncio.run(images.download(shot.get("url", "")))
        data, info = images.normalize(raw)
    except (TimeoutError, httpx.HTTPError):
        raise ValidationError("The screenshot download timed out or failed. Try again.") from None
    except ValueError as exc:
        raise ValidationError(str(exc)) from None
    with transaction.atomic():
        Workspace.objects.select_for_update().get(pk=app.workspace_id)
        workspace_access(request.user, workspace_id, write=True, module="studio")
        existing = app.scene_assets.defer("data").filter(source_key=key).first()
        if existing:
            return Response(representation(existing))
        if app.scene_assets.count() >= MAX_ASSETS:
            raise ValidationError("This app's library has reached its 60-image limit.")
        asset = SceneAsset.objects.create(
            app=app,
            source_key=key,
            data=data,
            metadata={
                **info,
                "kind": "store_screenshot",
                "snapshot_id": str(snapshot.pk),
                "position": values["position"],
                "source_url": shot["url"],
                "name": str(shot.get("name", "Store screenshot"))[:300],
                "locale": snapshot.data.get("screenshots_locale", ""),
                "imported_at": snapshot.captured_at.isoformat(),
            },
        )
    return Response(representation(asset), status=201)


@api_view(["GET"])
def image(request, workspace_id, asset_id):
    workspace = workspace_access(request.user, workspace_id, module="studio")
    asset = get_object_or_404(SceneAsset, pk=asset_id, app__workspace=workspace)
    response = HttpResponse(bytes(asset.data), content_type="image/jpeg")
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response
