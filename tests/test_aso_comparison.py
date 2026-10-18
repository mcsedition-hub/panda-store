"""Compose saved proposals without generation or trusting client-supplied text."""

import copy
import uuid
from unittest.mock import patch

import pytest

from addons.app_catalog.models import MobileApp
from addons.aso.models import AuditRun, ListingDraft
from addons.aso.rules import FIELDS
from addons.aso.workflow import create_workflow
from panda_store.core.models import Membership
from tests.test_aso_project import connection, finish, project  # noqa: F401
from tests.test_aso_project import run as project_run

run = project_run


@pytest.fixture
def analyses(run, owner, workspace):
    first, _ = run
    finish(first)
    workflow = create_workflow(workspace, owner, project=True)
    workflow.status = "succeeded"
    workflow.save(update_fields=["status"])
    inputs = copy.deepcopy(first.inputs)
    inputs["ai"].update(provider="google", model="gemini-test")
    report = copy.deepcopy(first.report)
    for item in report["project"]["fields"]:
        if item["field"] == "promotional_text":
            item["text"] = "Des plans pour vos premières courses."
    second = AuditRun.objects.create(
        workspace=workspace,
        app=first.app,
        workflow=workflow,
        inputs=inputs,
        locale=first.locale,
        request_id=uuid.uuid4(),
        report=report,
    )
    return first, second


def body(first, second):
    return {
        "request_id": str(uuid.uuid4()),
        "name": "My combined listing",
        "comparison": {
            "base_audit_id": str(first.pk),
            "selections": [
                {
                    "field": field,
                    "audit_id": str(second.pk if field == "promotional_text" else first.pk),
                    "check_id": "project.listing",
                }
                for field in FIELDS
            ],
        },
    }


def url(workspace, first):
    return f"/api/workspaces/{workspace.pk}/aso/apps/{first.app_id}/drafts/"


def test_composition_keeps_exact_saved_text_and_provenance_and_is_idempotent(
    api, workspace, analyses
):
    first, second = analyses
    payload = body(first, second)
    before = (copy.deepcopy(first.report), copy.deepcopy(second.report))
    with patch("addons.aso.editorial.generate") as generate:
        response = api.post(url(workspace, first), payload, format="json")
        assert response.status_code == 201, response.data
        draft = response.data
        assert len(draft["content"]) == 5 and draft["status"] == "draft"
        for field in FIELDS:
            source = second if field == "promotional_text" else first
            expected = next(
                item for item in source.report["project"]["fields"] if item["field"] == field
            )
            assert draft["content"][field] == expected["text"]
            trace = next(item for item in draft["provenance"] if item["check"]["field"] == field)
            assert trace["audit_id"] == str(source.pk)
            assert trace["model"] == source.inputs["ai"]["model"]
            assert trace["check"]["evidence"] == expected["evidence"]
        replay = api.post(url(workspace, first), payload, format="json")
        assert replay.status_code == 200 and replay.data["id"] == draft["id"]
        assert ListingDraft.objects.count() == 1
        changed = copy.deepcopy(payload)
        changed["comparison"]["selections"][0]["audit_id"] = str(second.pk)
        assert api.post(url(workspace, first), changed, format="json").status_code == 409
        exported = api.get(
            f"/api/workspaces/{workspace.pk}/aso/drafts/{draft['id']}/export/?version=1"
        )
        assert draft["content"]["promotional_text"] in exported.content.decode()
        generate.assert_not_called()
    first.refresh_from_db()
    second.refresh_from_db()
    assert (first.report, second.report) == before


@pytest.mark.parametrize(
    "invalid",
    [
        "language",
        "mode",
        "failed",
        "rejected",
        "missing",
        "duplicate",
        "unknown",
        "other_app",
        "check",
        "wrong_field",
    ],
)
def test_invalid_compositions_never_create_a_draft(api, workspace, analyses, invalid):
    first, second = analyses
    payload = body(first, second)
    selections = payload["comparison"]["selections"]
    if invalid == "language":
        second.locale = "en-US"
        second.save()
    elif invalid == "mode":
        second.inputs["mode"] = "screenshots"
        second.save()
    elif invalid == "failed":
        second.workflow.status = "failed"
        second.workflow.save()
    elif invalid == "rejected":
        second.report["project"]["accepted"] = False
        second.save()
    elif invalid == "missing":
        selections.pop()
    elif invalid == "duplicate":
        selections[1] = selections[0]
    elif invalid == "unknown":
        selections[-1]["audit_id"] = str(uuid.uuid4())
    elif invalid == "other_app":
        second.app = MobileApp.objects.create(
            workspace=workspace, name="Other", platform="ios", external_id="other"
        )
        second.save()
    elif invalid == "check":
        selections[-1]["check_id"] = "invented.check"
    elif invalid == "wrong_field":
        # A real saved check cannot be attributed to a different target field.
        second.report["checks"] = [
            {"id": "subtitle.edit", "field": "subtitle", "replacement": "A subtitle", "sources": []}
        ]
        second.save()
        selections[-1]["check_id"] = "subtitle.edit"
    response = api.post(url(workspace, first), payload, format="json")
    assert response.status_code == 400, response.data
    assert not ListingDraft.objects.exists()


def test_composition_allows_different_saved_versions_but_keeps_reference_and_sources(
    api, workspace, analyses
):
    first, second = analyses
    second.inputs["snapshot_id"] = str(uuid.uuid4())
    second.save()
    response = api.post(url(workspace, first), body(first, second), format="json")
    assert response.status_code == 201, response.data
    assert response.data["snapshot_id"] == first.inputs["snapshot_id"]
    trace = next(
        item for item in response.data["provenance"] if item["check"]["field"] == "promotional_text"
    )
    assert trace["snapshot_id"] == second.inputs["snapshot_id"]


def test_viewer_cannot_compose_saved_proposals(api, workspace, analyses):
    first, second = analyses
    Membership.objects.filter(workspace=workspace).update(role="viewer")
    assert api.post(url(workspace, first), body(first, second), format="json").status_code == 403
    assert not ListingDraft.objects.exists()


def test_imported_listing_composition_keeps_unselected_reference_fields(api, workspace, analyses):
    first, second = analyses
    for item in analyses:
        item.inputs["mode"] = "listing"
        item.report = {
            "checks": [
                {
                    "id": "subtitle.edit",
                    "field": "subtitle",
                    "replacement": "Plan your runs",
                    "observation": "Clear benefit",
                    "sources": [],
                }
            ]
        }
        item.save()
    payload = body(first, second)
    payload["comparison"]["selections"] = [
        {"field": "subtitle", "audit_id": str(second.pk), "check_id": "subtitle.edit"}
    ]
    response = api.post(url(workspace, first), payload, format="json")
    assert response.status_code == 201, response.data
    assert response.data["content"]["subtitle"] == "Plan your runs"
    assert response.data["content"]["description"] == response.data["baseline"]["description"]
    assert len(response.data["provenance"]) == 1
