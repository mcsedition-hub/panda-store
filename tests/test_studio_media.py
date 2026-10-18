import hashlib
import io
import json
import subprocess
import uuid
import zipfile
from unittest.mock import patch

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from addons.app_catalog.models import MobileApp
from addons.studio import media
from addons.studio.models import (
    Creative,
    GenerationRun,
    RenderPart,
    SceneAsset,
    VideoRender,
)
from addons.studio.render_tasks import render_video
from panda_store.core.models import Membership, User, Workspace
from panda_store.workflows import services


@pytest.fixture(scope="session")
def media_files(tmp_path_factory):
    if not media.available():
        pytest.skip("FFmpeg/ffprobe are required for real media integration tests.")
    path = tmp_path_factory.mktemp("media-fixtures")
    subprocess.run(
        [
            "ffmpeg",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=160x240:d=3:r=30",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=3",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            str(path / "screen.mp4"),
        ],
        check=True,
        timeout=15,
    )
    subprocess.run(
        [
            "ffmpeg",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=880:duration=0.5",
            str(path / "voice.wav"),
        ],
        check=True,
        timeout=10,
    )
    return path


def root(workspace):
    return f"/api/workspaces/{workspace.pk}/studio/"


@pytest.fixture
def board(api, workspace, imported, owner, settings):
    settings.PANDA_WORKFLOW_DISPATCH = "database"
    run = GenerationRun.objects.create(
        workspace=workspace,
        app_id=imported["id"],
        request_id=uuid.uuid4(),
        status="succeeded",
        inputs={"brief": {"duration_seconds": 15}},
        created_by=owner,
    )
    creative = Creative.objects.create(
        run=run, variant=1, angle="Recording", hook="", script="Show the app", cta=""
    )
    result = api.post(root(workspace) + f"creatives/{creative.pk}/storyboard/", {}, format="json")
    return result.data


def upload(api, workspace, imported, name, data):
    return api.post(
        root(workspace) + f"apps/{imported['id']}/media/",
        {"file": SimpleUploadedFile(name, data)},
        format="multipart",
    )


def attach(api, workspace, board, visual_id, audio_id=None, *, duration=1):
    scenes = [
        {
            **board["scenes"][0],
            "asset_id": visual_id,
            "duration": duration,
            "caption": "Literal : %{} ; ' caption",
            "audio_asset_id": audio_id,
            "video_start": 0.5,
            "audio_start": 0,
        }
    ]
    result = api.patch(
        root(workspace) + f"storyboards/{board['id']}/",
        {"request_id": str(uuid.uuid4()), "version": board["version"], "scenes": scenes},
        format="json",
    )
    assert result.status_code == 200, result.data
    return result.data


def start(api, workspace, board, request_id=None):
    return api.post(
        root(workspace) + f"storyboards/{board['id']}/renders/",
        {"request_id": str(request_id or uuid.uuid4()), "version": board["version"]},
        format="json",
    )


@pytest.mark.django_db(transaction=True)
def test_real_upload_render_and_private_range_download(
    api, workspace, imported, board, media_files
):
    video = upload(
        api, workspace, imported, "screen.mp4", (media_files / "screen.mp4").read_bytes()
    )
    audio = upload(api, workspace, imported, "voice.wav", (media_files / "voice.wav").read_bytes())
    assert video.status_code == audio.status_code == 201
    assert video.data["kind"] == "video" and audio.data["kind"] == "audio"
    assert (
        upload(
            api, workspace, imported, "same.mp4", (media_files / "screen.mp4").read_bytes()
        ).data["id"]
        == video.data["id"]
    )
    ranged = api.get(video.data["url"], HTTP_RANGE="bytes=0-15")
    assert ranged.status_code == 206 and len(ranged.content) == 16
    assert ranged["Cache-Control"] == "private, no-store"
    assert api.get(video.data["url"], HTTP_RANGE="bytes=999999999-").status_code == 416
    board = attach(api, workspace, board, video.data["id"], audio.data["id"])
    requested = start(api, workspace, board)
    assert requested.status_code == 202, requested.data
    render_video(requested.data["id"])
    render = VideoRender.objects.get(pk=requested.data["id"])
    assert render.workflow.status == "succeeded", render.workflow.error
    assert render.metadata["width"] == 1080 and render.metadata["height"] == 1920
    assert abs(render.metadata["duration"] - 1) < 0.15
    assert render.metadata["has_audio"]
    downloaded = api.get(root(workspace) + f"renders/{render.pk}/video/?download=1")
    assert downloaded["Content-Type"] == "video/mp4"
    assert hashlib.sha256(downloaded.content).hexdigest() == render.metadata["sha256"]
    assert api.delete(root(workspace) + f"scene-assets/{audio.data['id']}/file/").status_code == 400
    archive = api.get(root(workspace) + f"storyboards/{board['id']}/export/")
    with zipfile.ZipFile(io.BytesIO(archive.content)) as zipped:
        manifest = json.loads(zipped.read("storyboard.json"))
        assert {a["file"].rsplit(".", 1)[-1] for a in manifest["assets"]} == {"mp4", "wav"}
    assert api.delete(root(workspace) + f"renders/{render.pk}/").status_code == 204
    assert SceneAsset.objects.count() == 2 and RenderPart.objects.count() == 0


def image_asset(imported):
    output = io.BytesIO()
    Image.new("RGB", (80, 140), "navy").save(output, format="JPEG")
    data = output.getvalue()
    return SceneAsset.objects.create(
        app_id=imported["id"],
        source_key="fixture",
        data=data,
        byte_size=len(data),
        metadata={
            "kind": "image",
            "mime_type": "image/jpeg",
            "sha256": hashlib.sha256(data).hexdigest(),
        },
    )


@pytest.mark.django_db(transaction=True)
def test_retry_reuses_saved_shots_after_assembly_failure(api, workspace, imported, board):
    asset = image_asset(imported)
    board = attach(api, workspace, board, str(asset.pk))
    request_id = uuid.uuid4()
    requested = start(api, workspace, board, request_id)
    with patch(
        "addons.studio.render_tasks.media.assemble",
        side_effect=media.MediaError("Interrupted assembly"),
    ):
        render_video(requested.data["id"])
    original = VideoRender.objects.get(pk=requested.data["id"])
    assert original.workflow.status == "failed" and original.parts.count() == 1
    assert start(api, workspace, board, request_id).data["id"] == str(original.pk)
    retry = api.post(
        root(workspace) + f"renders/{original.pk}/retry/",
        {"request_id": str(uuid.uuid4()), "version": board["version"]},
        format="json",
    )
    assert retry.status_code == 202
    assert api.delete(root(workspace) + f"renders/{original.pk}/").status_code == 400
    with patch(
        "addons.studio.render_tasks.media.encode_shot", side_effect=AssertionError("must reuse")
    ):
        render_video(retry.data["id"])
    second = VideoRender.objects.get(pk=retry.data["id"])
    assert second.workflow.status == "succeeded", second.workflow.error
    assert second.parts.count() == 0
    assert second.workflow.steps.get(key="shot_0").reused_from is not None
    assert api.delete(root(workspace) + f"renders/{second.pk}/").status_code == 204
    again = api.post(
        root(workspace) + f"renders/{original.pk}/retry/",
        {"request_id": str(uuid.uuid4()), "version": board["version"]},
        format="json",
    )
    assert again.status_code == 202


@pytest.mark.django_db(transaction=True)
def test_cancel_never_saves_late_encoder_result(api, workspace, imported, board):
    asset = image_asset(imported)
    board = attach(api, workspace, board, str(asset.pk))
    requested = start(api, workspace, board)
    render = VideoRender.objects.get(pk=requested.data["id"])

    def canceled(*args, **kwargs):
        services.cancel(render.workflow_id)
        return b"late output"

    with patch("addons.studio.render_tasks.media.encode_shot", side_effect=canceled):
        render_video(render.pk)
    render.refresh_from_db()
    assert render.workflow.status == "canceled"
    assert render.parts.count() == 0 and render.data is None


def test_no_render_without_visuals_or_with_excess_timing(
    api, workspace, imported, board, media_files
):
    assert start(api, workspace, board).status_code == 400
    video = upload(
        api, workspace, imported, "screen.mp4", (media_files / "screen.mp4").read_bytes()
    ).data
    board = attach(api, workspace, board, video["id"], duration=10)
    assert start(api, workspace, board).status_code == 400
    assert VideoRender.objects.count() == 0


def test_upload_limits_types_rights_and_cross_app_references(
    api, workspace, imported, board, owner, media_files
):
    assert (
        upload(
            api, workspace, imported, "unsafe.mp4", b"#EXTM3U\nhttp://localhost/private"
        ).status_code
        == 400
    )
    assert upload(api, workspace, imported, "unsafe.svg", b"<svg/>").status_code == 400
    assert (
        upload(api, workspace, imported, "oversized.wav", b"x" * (media.MAX_UPLOAD + 1)).status_code
        == 400
    )
    audio = upload(
        api, workspace, imported, "voice.wav", (media_files / "voice.wav").read_bytes()
    ).data
    app = MobileApp.objects.create(
        workspace=workspace, platform="ios", name="Other", external_id="other"
    )
    foreign = SceneAsset.objects.create(
        app=app, source_key="foreign", data=b"test", metadata={"kind": "audio"}
    )
    scenes = [{**board["scenes"][0], "audio_asset_id": str(foreign.pk)}]
    result = api.patch(
        root(workspace) + f"storyboards/{board['id']}/",
        {"request_id": str(uuid.uuid4()), "version": 1, "scenes": scenes},
        format="json",
    )
    assert result.status_code == 400
    Membership.objects.filter(user=owner, workspace=workspace).update(role="viewer")
    assert upload(api, workspace, imported, "voice.wav", b"fake").status_code == 403
    assert start(api, workspace, board).status_code == 403
    assert api.get(audio["url"]).status_code == 200
    outsider = User.objects.create_user(username="media-outsider")
    Workspace.objects.create(name="Elsewhere")
    api.force_authenticate(outsider)
    assert api.get(audio["url"]).status_code == 404
    api.force_authenticate(owner)
    workspace.modules.filter(module_id="studio").delete()
    assert api.get(audio["url"]).status_code == 403


def test_rejects_nonfinite_offsets(api, workspace, board):
    scenes = [{**board["scenes"][0], "video_start": "NaN"}]
    result = api.patch(
        root(workspace) + f"storyboards/{board['id']}/",
        {"request_id": str(uuid.uuid4()), "version": 1, "scenes": scenes},
        format="json",
    )
    assert result.status_code == 400


def test_subprocess_is_terminated_on_cancellation(tmp_path):
    import sys

    def cancel():
        raise services.ExecutionStopped()

    with pytest.raises(services.ExecutionStopped):
        media.run(
            [sys.executable, "-c", "import time; time.sleep(20)"], tmp_path, timeout=1, check=cancel
        )


def test_caption_is_literal_and_bounded():
    assert "%{metadata:secret}" in media.caption_lines("%{metadata:secret}")
    with pytest.raises(media.MediaError, match="seven lines"):
        media.caption_lines("x\n" * 10)
