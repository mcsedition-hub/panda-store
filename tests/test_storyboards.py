import hashlib
import io
import json
import uuid
import zipfile
from unittest.mock import patch

import httpx
import pytest
from PIL import Image

from addons.app_catalog.models import MobileApp
from addons.studio.models import Creative, GenerationRun, SceneAsset, Storyboard, StoryboardRevision
from addons.studio.storyboards import split_script
from panda_store.core.models import Membership, User, Workspace


@pytest.fixture
def creative(imported, workspace, owner):
    run = GenerationRun.objects.create(
        workspace=workspace,
        app_id=imported["id"],
        request_id=uuid.uuid4(),
        status="succeeded",
        created_by=owner,
        inputs={"brief": {"duration_seconds": 30}},
    )
    return Creative.objects.create(
        run=run,
        variant=1,
        angle="Gesture demo",
        hook="Sort at your pace.",
        script=(
            "[Scene 1: Phone on a desk]\nVoiceover: Swipe right to keep.\n\n"
            "[Scene 2: Review the bin]\nVoiceover: Check before deleting."
        ),
        cta="Explore the app.",
    )


def root(workspace):
    return f"/api/workspaces/{workspace.pk}/studio/"


def create(api, workspace, creative):
    return api.post(root(workspace) + f"creatives/{creative.pk}/storyboard/", {}, format="json")


def edit(api, workspace, board, **changes):
    body = {
        "request_id": str(uuid.uuid4()),
        "version": board["version"],
        "scenes": board["scenes"],
        **changes,
    }
    return api.patch(root(workspace) + f"storyboards/{board['id']}/", body, format="json")


def png():
    output = io.BytesIO()
    Image.new("RGB", (40, 90), "red").save(output, format="PNG")
    return output.getvalue()


def setup_shot(creative, url="https://is1-ssl.mzstatic.com/example.png"):
    snapshot = creative.run.app.snapshots.first()
    snapshot.data["screenshots"] = [{"url": url, "name": "actual-app.png"}]
    snapshot.save()
    return snapshot


def import_shot(api, workspace, creative, snapshot):
    return api.post(
        root(workspace) + f"apps/{creative.run.app_id}/scene-assets/",
        {
            "snapshot_id": str(snapshot.pk),
            "position": 0,
        },
        format="json",
    )


def test_plan_preserves_script_and_idempotent_creation(api, workspace, creative):
    response = create(api, workspace, creative)
    assert response.status_code == 201
    data = response.data
    assert len(data["scenes"]) == 4
    assert sum(row["duration"] for row in data["scenes"]) == 30
    assert data["scenes"][1]["visual"] == "Phone on a desk"
    assert data["scenes"][1]["voiceover"] == "Swipe right to keep."
    assert all(row["asset_id"] is None for row in data["scenes"])
    assert data["source"]["script"] == creative.script
    assert not data["script_changed"]
    again = create(api, workspace, creative)
    assert again.status_code == 200 and again.data["id"] == data["id"]
    assert Storyboard.objects.count() == StoryboardRevision.objects.count() == 1
    creative.refresh_from_db()
    assert not creative.approved


def test_unknown_script_format_loses_no_text(creative):
    creative.script = "Intro text\n[Scene 1: Something]\nVO: Keep all this.\nProduction note."
    rows = split_script(creative)
    assert len(rows) == 3
    assert rows[1]["voiceover"] == creative.script


def test_edits_revision_replay_and_conflicts(api, workspace, creative):
    board = create(api, workspace, creative).data
    board["scenes"][0]["caption"] = "Keep what matters"
    request_id = str(uuid.uuid4())
    response = edit(api, workspace, board, request_id=request_id)
    assert response.status_code == 200 and response.data["version"] == 2
    assert edit(api, workspace, board, request_id=request_id).status_code == 200
    assert StoryboardRevision.objects.count() == 2
    assert edit(api, workspace, board).status_code == 409
    board["scenes"][0]["caption"] = "Different replay"
    assert edit(api, workspace, board, request_id=request_id).status_code == 409
    assert edit(api, workspace, response.data).status_code == 200
    assert edit(api, workspace, board, request_id=request_id).status_code == 409


@pytest.mark.parametrize("change", ["duplicate_id", "duration", "total", "empty", "foreign_asset"])
def test_rejects_invalid_plan(api, workspace, creative, change):
    board = create(api, workspace, creative).data
    scenes = board["scenes"]
    if change == "duplicate_id":
        scenes[1]["id"] = scenes[0]["id"]
    elif change == "duration":
        scenes[0]["duration"] = 0
    elif change == "total":
        scenes = [{**scenes[0], "id": str(uuid.uuid4()), "duration": 120} for _ in range(6)]
    elif change == "empty":
        scenes = []
    else:
        app = MobileApp.objects.create(
            workspace=workspace, name="Other app", external_id="other", platform="ios"
        )
        asset = SceneAsset.objects.create(app=app, source_key="other", data=png(), metadata={})
        scenes[0]["asset_id"] = str(asset.pk)
    assert edit(api, workspace, board, scenes=scenes).status_code == 400
    assert StoryboardRevision.objects.count() == 1


def test_source_changes_preserve_plan(api, workspace, creative):
    board = create(api, workspace, creative).data
    creative.script = "New script"
    creative.save()
    response = api.get(root(workspace) + f"storyboards/{board['id']}/")
    assert response.data["script_changed"]
    assert response.data["scenes"] == board["scenes"]
    assert response.data["source"]["script"] != creative.script
    assert create(api, workspace, creative).data["scenes"] == board["scenes"]


def test_import_image_and_export_exact_saved_revision(api, workspace, creative):
    snapshot = setup_shot(creative)
    with patch("addons.studio.scene_assets.images.download", return_value=png()) as fetch:
        imported = import_shot(api, workspace, creative, snapshot)
        assert imported.status_code == 201
        again = import_shot(api, workspace, creative, snapshot)
        assert again.status_code == 200 and fetch.call_count == 1
    asset = imported.data
    image = api.get(asset["url"])
    assert image["Content-Type"] == "image/jpeg"
    assert image["Cache-Control"] == "private, no-store"
    assert hashlib.sha256(image.content).hexdigest() == asset["sha256"]
    assert not workspace.modules.filter(module_id="aso").exists()
    board = create(api, workspace, creative).data
    board["scenes"][0]["asset_id"] = asset["id"]
    board = edit(api, workspace, board).data
    old = board["scenes"][0]["voiceover"]
    board["scenes"][0]["voiceover"] = "Later edit"
    assert edit(api, workspace, board).status_code == 200
    exported = api.get(root(workspace) + f"storyboards/{board['id']}/export/?version=2")
    assert exported.status_code == 200
    with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
        manifest = json.loads(archive.read("storyboard.json"))
        assert manifest["scenes"][0]["voiceover"] == old
        assert manifest["version"] == 2
        assert archive.read(f"assets/{asset['id']}.jpg") == image.content
        assert "storyboard.md" in archive.namelist()
    assert (
        api.get(root(workspace) + f"storyboards/{board['id']}/export/?version=999").status_code
        == 404
    )
    SceneAsset.objects.filter(pk=asset["id"]).update(data=b"broken")
    assert (
        api.get(root(workspace) + f"storyboards/{board['id']}/export/?version=2").status_code == 400
    )


def test_unsupported_urls_never_fetched(api, workspace, creative):
    snapshot = setup_shot(creative, "http://127.0.0.1/private")
    with patch("panda_store.core.images.httpx.AsyncClient") as client:
        response = import_shot(api, workspace, creative, snapshot)
    assert response.status_code == 400
    client.assert_not_called()
    assert SceneAsset.objects.count() == 0
    listing = api.get(root(workspace) + f"apps/{creative.run.app_id}/scene-assets/")
    assert listing.data["candidates"] == []


@pytest.mark.parametrize(
    "failure",
    [TimeoutError(), httpx.ConnectError("internal address"), ValueError("Unsupported image")],
)
def test_import_failures_are_retryable_without_partial_assets(api, workspace, creative, failure):
    snapshot = setup_shot(creative)
    with patch("addons.studio.scene_assets.images.download", side_effect=failure):
        response = import_shot(api, workspace, creative, snapshot)
    assert response.status_code == 400
    assert "internal address" not in str(response.data)
    assert SceneAsset.objects.count() == 0
    with patch("addons.studio.scene_assets.images.download", return_value=png()):
        assert import_shot(api, workspace, creative, snapshot).status_code == 201


def test_workspace_module_and_viewer_permissions(api, workspace, creative, owner):
    board = create(api, workspace, creative).data
    snapshot = setup_shot(creative)
    with patch("addons.studio.scene_assets.images.download", return_value=png()):
        asset = import_shot(api, workspace, creative, snapshot).data
    paths = [
        f"storyboards/{board['id']}/",
        f"storyboards/{board['id']}/export/",
        f"scene-assets/{asset['id']}/image/",
        f"apps/{creative.run.app_id}/scene-assets/",
        f"creatives/{creative.pk}/storyboard/",
    ]
    outsider = User.objects.create_user(username="outsider")
    other = Workspace.objects.create(name="Other")
    Membership.objects.create(workspace=other, user=outsider, role="owner")
    api.force_authenticate(outsider)
    for path in paths:
        assert api.get(root(workspace) + path).status_code == 404
    api.force_authenticate(owner)
    membership = Membership.objects.get(workspace=workspace, user=owner)
    membership.role = "viewer"
    membership.save()
    for path in paths:
        assert api.get(root(workspace) + path).status_code == 200
    assert create(api, workspace, creative).status_code == 403
    assert edit(api, workspace, board).status_code == 403
    assert import_shot(api, workspace, creative, snapshot).status_code == 403
    workspace.modules.filter(module_id="studio").delete()
    for path in paths:
        assert api.get(root(workspace) + path).status_code == 403


def test_recheck_module_after_download(api, workspace, creative):
    snapshot = setup_shot(creative)

    from panda_store.core.images import normalize

    def disabled(data):
        workspace.modules.filter(module_id="studio").delete()
        return normalize(data)

    with (
        patch("addons.studio.scene_assets.images.download", return_value=png()),
        patch("addons.studio.scene_assets.images.normalize", side_effect=disabled),
    ):
        assert import_shot(api, workspace, creative, snapshot).status_code == 403
    assert SceneAsset.objects.count() == 0
