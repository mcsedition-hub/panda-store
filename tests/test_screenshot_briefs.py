import copy
import io
import json
import uuid
import zipfile

import pytest
from rest_framework.test import APIClient

from addons.app_catalog.models import MobileApp
from addons.aso.models import AuditRun, ScreenshotBrief, ScreenshotEvidence
from addons.aso.workflow import create_workflow
from panda_store.core.access import activate_modules, deactivate_module
from panda_store.core.models import Membership, Workspace


@pytest.fixture
def reviewed(workspace, owner):
    activate_modules(workspace, ["aso"])
    app = MobileApp.objects.create(
        workspace=workspace, name="Panda", platform="ios", external_id="panda"
    )
    workflow = create_workflow(workspace, owner, ai=True, screenshots=True)
    workflow.status = "succeeded"
    workflow.save()
    run = AuditRun.objects.create(
        workspace=workspace,
        app=app,
        workflow=workflow,
        request_id=uuid.uuid4(),
        locale="en-US",
        inputs={
            "snapshot_id": str(uuid.uuid4()),
            "captured_at": "2026-10-17T12:00:00Z",
            "metadata": {"locale": "en-US", "name": "Panda", "description": "Track runs."},
        },
    )
    image = ScreenshotEvidence.objects.create(
        audit=run, position=1, data=b"saved-image-bytes", metadata={}
    )
    run.report = {
        "visual": {
            "version": "test-version",
            "resolved_model": "test-model",
            "images": [
                {
                    "image_id": "shot-1",
                    "name": "run.png",
                    "status": "reviewed",
                    "verdict": "improve",
                    "asset_id": str(image.pk),
                    "url": "/old/private/url",
                    "observation": "A broad caption.",
                    "visible_text": "Run your way",
                    "recommendation": "Test a clearer message on shot-1.",
                    "sources": [
                        {
                            "id": "apple",
                            "publisher": "Apple",
                            "title": "Screenshots",
                            "url": "https://developer.apple.com/app-store/asset-best-practices/",
                            "limitations": "No conversion results.",
                            "reviewed_on": "2026-10-17",
                        }
                    ],
                }
            ],
        }
    }
    run.save()
    return run


def base(workspace, suffix):
    return f"/api/workspaces/{workspace.pk}/aso/{suffix}"


def create(api, workspace, run, **extra):
    payload = {
        "request_id": str(uuid.uuid4()),
        "audit_id": str(run.pk),
        "image_id": "shot-1",
        "name": "Clearer benefit",
        **extra,
    }
    response = api.post(
        base(workspace, f"apps/{run.app_id}/screenshot-briefs/"), payload, format="json"
    )
    return response, payload


def edit(api, workspace, brief, **changes):
    payload = {"request_id": str(uuid.uuid4()), "version": brief["version"], **changes}
    return api.patch(
        base(workspace, f"screenshot-briefs/{brief['id']}/"), payload, format="json"
    ), payload


def test_brief_keeps_review_evidence_and_create_is_idempotent(api, workspace, reviewed):
    response, payload = create(api, workspace, reviewed)
    assert response.status_code == 201, response.data
    brief = response.data
    assert brief["content"] == {
        "change": "Test a clearer message on run.png.",
        "screen": "",
        "caption": "",
        "test_plan": "",
    }
    assert brief["source"]["listing"]["description"] == "Track runs."
    assert brief["source"]["finding"]["sources"][0]["id"] == "apple"
    assert not brief["can_mark_ready"] and "url" not in brief["source"]["finding"]
    assert api.get(brief["reference_url"]).content == b"saved-image-bytes"
    path = base(workspace, f"apps/{reviewed.app_id}/screenshot-briefs/")
    assert api.post(path, payload, format="json").data["id"] == brief["id"]
    assert api.post(path, {**payload, "name": "Changed"}, format="json").status_code == 409
    assert ScreenshotBrief.objects.count() == 1
    reviewed.inputs["metadata"]["description"] = "Different listing"
    reviewed.report["visual"]["images"][0]["recommendation"] = "Different suggestion"
    reviewed.save()
    saved = api.get(base(workspace, f"screenshot-briefs/{brief['id']}/")).data
    assert saved["source"] == brief["source"]


@pytest.mark.parametrize(
    "change",
    [
        {"status": "withheld"},
        {"status": "unavailable"},
        {"verdict": "keep"},
        {"recommendation": ""},
        {"verdict": "insufficient_evidence"},
    ],
)
def test_unretained_findings_cannot_become_briefs(api, workspace, reviewed, change):
    reviewed.report["visual"]["images"][0].update(change)
    reviewed.save()
    response, _ = create(api, workspace, reviewed)
    assert response.status_code == 400
    assert not ScreenshotBrief.objects.exists()


def test_readiness_requires_explicit_review_and_edits_reset_it(api, workspace, reviewed):
    response, _ = create(api, workspace, reviewed)
    brief = response.data
    assert edit(api, workspace, brief, status="ready")[0].status_code == 400
    assert edit(api, workspace, brief, status="ready", claims_confirmed=True)[0].status_code == 400
    response, payload = edit(
        api,
        workspace,
        brief,
        content={"screen": "Show the training diary.", "caption": "Track each run"},
    )
    assert response.status_code == 200
    brief = response.data
    path = base(workspace, f"screenshot-briefs/{brief['id']}/")
    assert api.patch(path, payload, format="json").data["version"] == 2
    assert (
        api.patch(path, {**payload, "content": {"screen": "Other"}}, format="json").status_code
        == 409
    )
    assert (
        edit(api, workspace, brief, status="ready", claims_confirmed=True, content={})[
            0
        ].status_code
        == 400
    )
    response, _ = edit(api, workspace, brief, status="ready", claims_confirmed=True)
    assert response.status_code == 200 and response.data["status"] == "ready"
    ready = response.data
    assert edit(api, workspace, brief, content={"caption": "stale edit"})[0].status_code == 409
    response, _ = edit(api, workspace, ready, content={"caption": "A run diary"})
    assert response.status_code == 200 and response.data["status"] == "draft"
    current = response.data
    response, _ = edit(api, workspace, current, restore_version=ready["version"])
    assert response.status_code == 200 and response.data["status"] == "draft"
    assert response.data["content"] == ready["content"]
    assert response.data["version"] == current["version"] + 1
    history = api.get(path + "history/").data
    assert history[0]["reason"] == "Restored revision 3"
    assert history[2]["author"] == "owner" and history[2]["status"] == "ready"
    assert (
        edit(api, workspace, response.data, content={"unsupported": "value"})[0].status_code == 400
    )


def test_duplicate_is_an_independent_draft_and_export_pins_revision(api, workspace, reviewed):
    response, _ = create(api, workspace, reviewed)
    response, _ = edit(
        api, workspace, response.data, content={"screen": "Diary", "caption": "Run daily"}
    )
    response, _ = edit(api, workspace, response.data, status="ready", claims_confirmed=True)
    ready = response.data
    path = base(workspace, f"apps/{reviewed.app_id}/screenshot-briefs/")
    payload = {
        "request_id": str(uuid.uuid4()),
        "name": "Alternative",
        "duplicate_id": ready["id"],
        "version": ready["version"],
    }
    duplicated = api.post(path, payload, format="json")
    assert duplicated.status_code == 201
    assert duplicated.data["status"] == "draft" and duplicated.data["version"] == 1
    assert duplicated.data["source"] == ready["source"]
    assert api.post(path, payload, format="json").data["id"] == duplicated.data["id"]
    edit(api, workspace, duplicated.data, content={"caption": "Different message"})
    assert ScreenshotBrief.objects.get(pk=ready["id"]).content["caption"] == "Run daily"
    response, _ = edit(api, workspace, ready, content={"caption": "Later revision"})
    assert (
        api.post(path, {**payload, "request_id": str(uuid.uuid4())}, format="json").status_code
        == 409
    )
    exported = api.get(
        base(workspace, f"screenshot-briefs/{ready['id']}/export/?version={ready['version']}")
    )
    assert exported.status_code == 200 and exported["Cache-Control"] == "private, no-store"
    with zipfile.ZipFile(io.BytesIO(exported.content)) as bundle:
        assert set(bundle.namelist()) == {"brief.md", "brief.json", "reference.jpg"}
        data = json.loads(bundle.read("brief.json"))
        assert data["content"]["caption"] == "Run daily" and data["status"] == "ready"
        assert bundle.read("reference.jpg") == b"saved-image-bytes"
        assert b"No conversion results" in bundle.read("brief.md")
    assert (
        api.get(
            base(workspace, f"screenshot-briefs/{ready['id']}/export/?version=invalid")
        ).status_code
        == 400
    )


def test_workspace_app_roles_and_module_isolation(api, workspace, reviewed, owner):
    response, payload = create(api, workspace, reviewed)
    brief = response.data
    other = Workspace.objects.create(name="Other")
    Membership.objects.create(workspace=other, user=owner, role="owner")
    activate_modules(other, ["aso"])
    other_app = MobileApp.objects.create(
        workspace=other, name="Other", platform="ios", external_id="other"
    )
    assert (
        api.post(
            base(other, f"apps/{other_app.pk}/screenshot-briefs/"), payload, format="json"
        ).status_code
        == 404
    )
    for suffix in ("", "history/", "export/"):
        assert api.get(base(other, f"screenshot-briefs/{brief['id']}/{suffix}")).status_code == 404
        assert APIClient().get(
            base(workspace, f"screenshot-briefs/{brief['id']}/{suffix}")
        ).status_code in {401, 403}
    Membership.objects.filter(workspace=workspace).update(role="viewer")
    assert api.get(base(workspace, f"screenshot-briefs/{brief['id']}/")).status_code == 200
    assert create(api, workspace, reviewed)[0].status_code == 403
    assert edit(api, workspace, brief, content={"caption": "No"})[0].status_code == 403
    deactivate_module(workspace, "aso")
    for suffix in ("", "history/", "export/"):
        assert (
            api.get(base(workspace, f"screenshot-briefs/{brief['id']}/{suffix}")).status_code == 403
        )


def test_reference_deletion_preserves_the_brief_and_marks_the_image_unavailable(
    api, workspace, reviewed
):
    response, _ = create(api, workspace, reviewed)
    brief = response.data
    source = copy.deepcopy(brief["source"])
    reviewed.delete()
    path = base(workspace, f"screenshot-briefs/{brief['id']}/")
    saved = api.get(path).data
    assert saved["reference_url"] is None and saved["source"] == source
    with zipfile.ZipFile(io.BytesIO(api.get(path + "export/").content)) as bundle:
        assert "reference.jpg" not in bundle.namelist()
        assert b"no longer available" in bundle.read("brief.md")
