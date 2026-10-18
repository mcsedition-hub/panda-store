"""Editable shot plans derived from saved scripts, with immutable revision exports."""

import hashlib
import io
import json
import math
import re
import uuid
import zipfile

from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.response import Response

from panda_store.core.access import workspace_access
from panda_store.core.models import Workspace

from .models import Creative, SceneAsset, Storyboard, StoryboardRevision


class Conflict(APIException):
    status_code = 409
    default_detail = "This storyboard changed elsewhere. Reload the saved version before editing."


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def script_source(creative):
    return {key: getattr(creative, key) for key in ("angle", "hook", "script", "cta")}


def scene(title, visual="", voiceover=""):
    return {
        "id": str(uuid.uuid4()),
        "title": title,
        "visual": visual,
        "voiceover": voiceover,
        "caption": "",
        "duration": 5,
        "asset_id": None,
    }


def split_script(creative):
    """Recognize explicit scene labels only; retain all other script text as one shot."""
    matches = list(re.finditer(r"(?m)^\[Scene \d+:\s*([^\]\n]+)\]\s*", creative.script))
    rows = [scene("Opening", voiceover=creative.hook)] if creative.hook else []
    if (
        matches
        and not creative.script[: matches[0].start()].strip()
        and len(matches) <= 18
        and all(len(match.group(1)) <= 1500 for match in matches)
    ):
        for index, match in enumerate(matches):
            end = matches[index + 1].start() if index + 1 < len(matches) else len(creative.script)
            text = creative.script[match.end() : end].strip()
            if text.startswith("Voiceover:"):
                text = text[len("Voiceover:") :].strip()
            rows.append(scene(f"Shot {index + 1}", visual=match.group(1).strip(), voiceover=text))
    else:
        rows.append(scene("Script", voiceover=creative.script))
    if creative.cta:
        rows.append(scene("Closing", voiceover=creative.cta))
    target = creative.run.inputs.get("brief", {}).get("duration_seconds", 30)
    target = target if type(target) is int and 15 <= target <= 60 else 30
    # Durations are editable starting points, not synthesized speech measurements.
    budget = max(target, len(rows)) - len(rows)
    weights = [max(1, len(row["voiceover"].split())) for row in rows]
    total = sum(weights)
    durations = [1 + budget * weight // total for weight in weights]
    for index in range(max(target, len(rows)) - sum(durations)):
        durations[index % len(rows)] += 1
    for row, duration in zip(rows, durations, strict=True):
        row["duration"] = duration
    return rows


class SceneInput(serializers.Serializer):
    id = serializers.UUIDField()
    title = serializers.CharField(max_length=80)
    visual = serializers.CharField(max_length=1500, allow_blank=True, trim_whitespace=False)
    voiceover = serializers.CharField(max_length=6000, allow_blank=True, trim_whitespace=False)
    caption = serializers.CharField(max_length=500, allow_blank=True, trim_whitespace=False)
    duration = serializers.IntegerField(min_value=1, max_value=120)
    asset_id = serializers.UUIDField(allow_null=True)
    audio_asset_id = serializers.UUIDField(allow_null=True, required=False, default=None)
    video_start = serializers.FloatField(min_value=0, max_value=120, default=0)
    audio_start = serializers.FloatField(min_value=0, max_value=120, default=0)
    original_audio = serializers.BooleanField(default=False)

    def validate(self, attrs):
        if not all(math.isfinite(attrs[key]) for key in ("video_start", "audio_start")):
            raise ValidationError("Recording start times must be finite numbers.")
        return attrs


class EditInput(serializers.Serializer):
    request_id = serializers.UUIDField()
    version = serializers.IntegerField(min_value=1)
    scenes = SceneInput(many=True, min_length=1, max_length=20)

    def validate_scenes(self, value):
        if len({row["id"] for row in value}) != len(value):
            raise ValidationError("Each scene needs a distinct ID.")
        if sum(row["duration"] for row in value) > 600:
            raise ValidationError("Keep the storyboard within ten minutes.")
        return [
            {
                **row,
                "id": str(row["id"]),
                "asset_id": str(row["asset_id"]) if row["asset_id"] else None,
                "audio_asset_id": str(row["audio_asset_id"]) if row["audio_asset_id"] else None,
            }
            for row in value
        ]


def representation(board):
    return {
        "id": str(board.pk),
        "creative_id": str(board.creative_id),
        "version": board.version,
        "source": board.source,
        "script_changed": digest(script_source(board.creative)) != board.source["fingerprint"],
        "scenes": board.scenes,
        "updated_at": board.updated_at,
    }


@api_view(["GET", "POST"])
def for_creative(request, workspace_id, creative_id):
    workspace = workspace_access(
        request.user, workspace_id, write=request.method == "POST", module="studio"
    )
    creative = get_object_or_404(
        Creative.objects.select_related("run"), pk=creative_id, run__workspace=workspace
    )
    if request.method == "GET":
        board = Storyboard.objects.filter(creative=creative).first()
        return Response({"storyboard": representation(board) if board else None})
    with transaction.atomic():
        Workspace.objects.select_for_update().get(pk=workspace.pk)
        workspace_access(request.user, workspace_id, write=True, module="studio")
        creative = Creative.objects.select_for_update().select_related("run").get(pk=creative.pk)
        board = Storyboard.objects.filter(creative=creative).first()
        if board:
            return Response(representation(board))
        source = script_source(creative)
        board = Storyboard.objects.create(
            creative=creative,
            scenes=split_script(creative),
            source={
                **source,
                "fingerprint": digest(source),
                "run_id": str(creative.run_id),
                "snapshot_id": creative.run.inputs.get("snapshot_id"),
                "script_updated_at": creative.updated_at.isoformat(),
                "provenance": creative.provenance,
                "method": "explicit_scene_labels_v1",
            },
        )
        StoryboardRevision.objects.create(
            board=board, version=1, scenes=board.scenes, operation="create"
        )
    return Response(representation(board), status=201)


@api_view(["GET", "PATCH"])
def detail(request, workspace_id, board_id):
    workspace = workspace_access(
        request.user, workspace_id, write=request.method == "PATCH", module="studio"
    )
    board = get_object_or_404(
        Storyboard.objects.select_related("creative__run"),
        pk=board_id,
        creative__run__workspace=workspace,
    )
    if request.method == "GET":
        return Response(representation(board))
    serializer = EditInput(data=request.data)
    serializer.is_valid(raise_exception=True)
    values = serializer.validated_data
    operation = digest({"version": values["version"], "scenes": values["scenes"]})
    with transaction.atomic():
        Workspace.objects.select_for_update().get(pk=workspace.pk)
        workspace_access(request.user, workspace_id, write=True, module="studio")
        board = (
            Storyboard.objects.select_for_update().select_related("creative__run").get(pk=board.pk)
        )
        replay = board.revisions.filter(request_id=values["request_id"]).first()
        if replay:
            if replay.operation != operation or replay.version != board.version:
                raise Conflict()
            return Response(representation(board))
        if values["version"] != board.version:
            raise Conflict()
        asset_ids = {
            row.get(key)
            for row in values["scenes"]
            for key in ("asset_id", "audio_asset_id")
            if row.get(key)
        }
        owned = {
            str(a.pk): a
            for a in SceneAsset.objects.filter(
                app_id=board.creative.run.app_id, pk__in=asset_ids
            ).defer("data")
        }
        if asset_ids != set(owned):
            raise ValidationError("Choose media from this app's asset library.")
        for row in values["scenes"]:
            if row["asset_id"] and owned[row["asset_id"]].metadata.get("kind") == "audio":
                raise ValidationError("Choose an image or video as the visual.")
            if (
                row["audio_asset_id"]
                and owned[row["audio_asset_id"]].metadata.get("kind") != "audio"
            ):
                raise ValidationError("Choose an audio file for the voiceover.")
        board.scenes = values["scenes"]
        board.version += 1
        board.save(update_fields=["scenes", "version", "updated_at"])
        StoryboardRevision.objects.create(
            board=board,
            version=board.version,
            scenes=board.scenes,
            request_id=values["request_id"],
            operation=operation,
        )
    return Response(representation(board))


@api_view(["GET"])
def export(request, workspace_id, board_id):
    workspace = workspace_access(request.user, workspace_id, module="studio")
    board = get_object_or_404(
        Storyboard.objects.select_related("creative__run__app"),
        pk=board_id,
        creative__run__workspace=workspace,
    )
    try:
        version = int(request.query_params.get("version", board.version))
    except (ValueError, TypeError):
        raise ValidationError("Choose a saved version.") from None
    revision = get_object_or_404(StoryboardRevision, board=board, version=version)
    from .media import asset_suffix

    asset_ids = {
        row.get(key)
        for row in revision.scenes
        for key in ("asset_id", "audio_asset_id")
        if row.get(key)
    }
    assets = list(SceneAsset.objects.filter(app_id=board.creative.run.app_id, pk__in=asset_ids))
    if len(assets) != len(asset_ids):
        raise ValidationError("A referenced visual is unavailable. Save a revised storyboard.")
    files = {str(a.pk): f"assets/{a.pk}.{asset_suffix(a)}" for a in assets}
    manifest = {
        "format": "panda-store-storyboard-v1",
        "version": version,
        "app": board.creative.run.app.name,
        "source": board.source,
        "canvas": {"width": 1080, "height": 1920, "fit": "contain"},
        "scenes": revision.scenes,
        "assets": [
            {"id": str(a.pk), "file": f"assets/{a.pk}.{asset_suffix(a)}", **a.metadata}
            for a in assets
        ],
        "notes": (
            "Editing package with selected media. "
            "Voiceover text is a script, not synthesized speech. "
            "Imported store images are derivatives and may contain marketing text."
        ),
    }
    lines = [f"# {manifest['app']} — storyboard", f"Version {version}", "", manifest["notes"], ""]
    elapsed = 0
    for row in revision.scenes:
        lines.extend(
            [
                f"## {row['title']} · {elapsed}–{elapsed + row['duration']}s",
                f"Visual: {row['visual'] or 'To prepare'}",
                f"Voiceover: {row['voiceover']}",
                f"On-screen text: {row['caption']}",
                f"Asset: {files[row['asset_id']]}"
                if row["asset_id"]
                else "Asset: to select or record",
                f"Voiceover file: {files.get(row.get('audio_asset_id'), 'None')}",
                f"Clip starts at {row.get('video_start', 0)}s; "
                f"audio starts at {row.get('audio_start', 0)}s.",
                "",
            ]
        )
        elapsed += row["duration"]
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("storyboard.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        archive.writestr("storyboard.md", "\n".join(lines))
        for asset in assets:
            data = bytes(asset.data)
            if hashlib.sha256(data).hexdigest() != asset.metadata["sha256"]:
                raise ValidationError("A saved visual could not be verified. Import it again.")
            archive.writestr(f"assets/{asset.pk}.{asset_suffix(asset)}", data)
    response = HttpResponse(output.getvalue(), content_type="application/zip")
    response["Content-Disposition"] = f'attachment; filename="storyboard-v{version}.zip"'
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response
