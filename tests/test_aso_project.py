"""Idea -> ASO analysis -> complete editable listing, without an existing store listing."""

import copy
import uuid
from unittest.mock import patch

import pytest

from addons.app_catalog.models import MobileApp
from addons.aso import editorial
from addons.aso import project as proposal
from addons.aso.models import AuditRun, ListingDraft
from addons.aso.rules import FIELDS
from addons.aso.tasks import audit_listing
from panda_store.ai.providers import ProviderError
from panda_store.core.access import activate_modules
from panda_store.core.models import Membership
from panda_store.workflows import services
from tests.test_ai import connection as ai_connection
from tests.test_ai import start
from tests.test_projects import edit
from tests.test_projects import project as idea_project

connection = ai_connection
project = idea_project


@pytest.fixture
def run(api, workspace, project, connection):
    activate_modules(workspace, ["aso"])
    app = MobileApp.objects.get(pk=project[0]["id"])
    response, body = start(
        api, workspace, (app, app.snapshots.first()), locale="fr-CA", mode="project"
    )
    assert response.status_code == 202, response.data
    return AuditRun.objects.get(pk=response.data["id"]), body


def writing():
    texts = {
        "name": "Carnet de course",
        "subtitle": "Vos prochains pas",
        "description": "Débutez la course avec des plans adaptés à vos premiers pas.",
        "keywords": "débutant,entraînement,calendrier",
        "promotional_text": "Trouvez votre rythme avec des plans pour débuter la course.",
    }
    return {
        "result": {
            "analysis": {
                "positioning": "Des plans de course pour débutants.",
                "audience": "Débutants en course à pied",
                "search_intents": ["plan course débutant"],
                "missing_information": ["Quels types de plans seront proposés ?"],
            },
            "listing": {
                field: {
                    "text": text,
                    "rationale": "Met en avant les plans de course et le public débutant.",
                    "evidence": [
                        {"field": "specification", "quote": "Des plans de course sont envisagés."}
                    ],
                    "source_ids": ["apple-search" if field == "keywords" else "apple-product-page"],
                }
                for field, text in texts.items()
            },
        },
        "usage": {"input_tokens": 200, "output_tokens": 400},
        "resolved_model": "model-test",
    }


def verification(rejected=None):
    return {
        "result": {
            "reviews": [
                {"id": key, "supported": key != rejected, "reason": "Comparé à l’idée enregistrée."}
                for key in ["analysis", *FIELDS]
            ]
        },
        "usage": {"input_tokens": 400, "output_tokens": 100},
    }


def finish(run):
    with patch.object(editorial, "generate", side_effect=[writing(), verification()]) as model:
        audit_listing(str(run.workflow_id))
    run.refresh_from_db()
    assert run.workflow.status == "succeeded", run.workflow.error
    return model


def test_idea_to_full_listing_and_editable_draft_without_store_or_prepared_text(
    api, workspace, project, run
):
    task, body = run
    assert task.app.platform == "undecided"
    assert task.inputs["metadata"]["description"] == ""
    assert task.workflow.workflow_key == "aso.project"
    model = finish(task)
    assert model.call_count == 2
    assert all(call.args[4]["purpose"] == "aso_project" for call in model.call_args_list)
    result = task.report["project"]
    assert result["accepted"] and len(result["fields"]) == 5
    assert result["analysis"]["missing_information"]
    base = f"/api/workspaces/{workspace.pk}/aso/"
    create = {
        "request_id": str(uuid.uuid4()),
        "name": "Première fiche",
        "audit_id": str(task.pk),
        "check_id": "project.listing",
    }
    response = api.post(f"{base}apps/{task.app_id}/drafts/", create, format="json")
    assert response.status_code == 201, response.data
    draft = response.data
    assert draft["content"] == {
        field: item["text"] for field, item in writing()["result"]["listing"].items()
    }
    assert draft["baseline"]["description"] == ""
    assert draft["status"] == "draft" and len(draft["provenance"]) == 5
    assert (
        api.post(f"{base}apps/{task.app_id}/drafts/", create, format="json").data["id"]
        == draft["id"]
    )
    assert ListingDraft.objects.count() == 1
    updated = api.patch(
        f"{base}drafts/{draft['id']}/",
        {"request_id": str(uuid.uuid4()), "version": 1, "content": {"subtitle": "Ma proposition"}},
        format="json",
    )
    assert updated.status_code == 200 and updated.data["content"]["subtitle"] == "Ma proposition"
    exported = api.get(f"{base}drafts/{draft['id']}/export/?version=1")
    assert exported.status_code == 200 and "Vos prochains pas" in exported.content.decode()
    assert writing()["result"]["listing"]["promotional_text"]["text"] in exported.content.decode()
    assert "Ma proposition" not in exported.content.decode()
    assert len(model.call_args_list) == 2  # Editing and export do not regenerate.
    assert api.get(f"{base}apps/{task.app_id}/runs/").data[0]["report"] == task.report
    assert task.app.snapshots.count() == 1  # Proposed texts never become imported product evidence.


@pytest.mark.parametrize("change_model", [False, True])
def test_project_analysis_freezes_full_idea_language_and_retry_reuses_writing(
    api, owner, workspace, project, run, connection, change_model
):
    task, body = run
    original = copy.deepcopy(task.inputs)
    assert len(original["app_context"]["specification"]) > 8000
    assert (
        edit(api, project, specification="Une autre idée pour une application différente.")[
            0
        ].status_code
        == 200
    )
    owner.language = "fr"
    owner.save(update_fields=["language"])
    with patch.object(
        editorial, "generate", side_effect=[writing(), ProviderError("Test timeout")]
    ) as model:
        audit_listing(str(task.workflow_id))
    task.refresh_from_db()
    assert task.workflow.status == "failed"
    assert task.report is None
    base = f"/api/workspaces/{workspace.pk}/aso/"
    choice = {}
    if change_model:
        connection.model_catalog.append({"id": "gpt-4.1"})
        connection.save()
        choice = {"provider": "openai", "model": "gpt-4.1"}
    response = api.post(
        f"{base}runs/{task.pk}/retry/", {"request_id": str(uuid.uuid4()), **choice}, format="json"
    )
    assert response.status_code == 202, response.data
    retry = AuditRun.objects.get(pk=response.data["id"])
    expected = copy.deepcopy(original)
    expected["ai"].update(choice)
    assert retry.inputs == expected
    with patch.object(
        editorial,
        "generate",
        side_effect=[writing(), verification()] if change_model else [verification()],
    ) as reviewer:
        audit_listing(str(retry.workflow_id))
    retry.refresh_from_db()
    assert retry.workflow.status == "succeeded", retry.workflow.error
    assert reviewer.call_count == (2 if change_model else 1)
    assert bool(retry.workflow.steps.get(key="strategy").reused_from_id) == (not change_model)
    for call in [*model.call_args_list, *reviewer.call_args_list]:
        assert call.args[4]["app_context"] == original["app_context"]
        assert call.kwargs["response_language"] == original["response_language"]
    replay = api.post(f"{base}apps/{task.app_id}/runs/", body, format="json")
    assert replay.status_code == 200 and replay.data["id"] == str(task.pk)


@pytest.mark.parametrize(
    ("invalid", "message"),
    [
        ("length", "subtitle contains 31 characters; the limit is 30"),
        ("utf8", "keywords contains 102 UTF-8 bytes; the limit is 100"),
        ("quote", "A quote supporting description does not match the saved project"),
        ("source", "The sources for subtitle are invalid for this field"),
        ("missing", "listing is incomplete or has an invalid structure"),
        ("blank", "description is empty"),
    ],
)
def test_invalid_generated_listing_never_becomes_a_proposal(api, workspace, run, invalid, message):
    task, _ = run
    output = writing()
    fields = output["result"]["listing"]
    if invalid == "length":
        fields["subtitle"]["text"] = "x" * 31
    if invalid == "utf8":
        fields["keywords"]["text"] = "é" * 51
    if invalid == "quote":
        fields["description"]["evidence"][0]["quote"] = "An invented guarantee."
    if invalid == "source":
        fields["subtitle"]["source_ids"] = ["apple-search"]
    if invalid == "missing":
        del fields["name"]
    if invalid == "blank":
        fields["description"]["text"] = ""
    with patch.object(editorial, "generate", return_value=output) as model:
        audit_listing(str(task.workflow_id))
    task.refresh_from_db()
    assert task.workflow.status == "failed"
    assert task.report is None and model.call_count == 1
    assert message in task.workflow.error
    assert task.workflow.steps.get(key="strategy").output == output
    assert task.workflow.steps.get(key="validate_project").status == "failed"
    # Raw rejected content stays private, including model text and invalid citations.
    base = f"/api/workspaces/{workspace.pk}"
    activity = api.get(f"{base}/workflows/{task.workflow_id}/")
    assert activity.status_code == 200
    assert all("output" not in step for step in activity.data["steps"])
    assert "An invented guarantee" not in str(activity.data)


def test_retry_corrects_rejected_writing_using_original_project_and_validation_feedback(
    api, workspace, project, run
):
    task, _ = run
    output = writing()
    output["result"]["listing"]["subtitle"]["text"] = "x" * 31
    with patch.object(editorial, "generate", return_value=output):
        audit_listing(str(task.workflow_id))
    assert (
        edit(api, project, specification="Un projet entièrement différent.")[0].status_code == 200
    )
    response = api.post(
        f"/api/workspaces/{workspace.pk}/aso/runs/{task.pk}/retry/",
        {"request_id": str(uuid.uuid4())},
        format="json",
    )
    assert response.status_code == 202, response.data
    retry = AuditRun.objects.get(pk=response.data["id"])
    assert retry.workflow.steps.get(key="project").reused_from_id is not None
    assert retry.workflow.steps.get(key="strategy").reused_from_id is None
    assert retry.inputs == task.inputs
    model = finish(retry)
    assert model.call_count == 2
    context = model.call_args_list[0].args[4]
    assert context["app_context"] == task.inputs["app_context"]
    assert context["correction"]["previous_proposal"] == output["result"]
    assert "subtitle contains 31 characters" in context["correction"]["validation_error"]


def test_generation_contract_scopes_sources_and_measures_utf8_without_relaxing_limits(run):
    task, _ = run
    original = copy.deepcopy(proposal.SCHEMA)
    schema, requirements = proposal.generation_contract(task.inputs)
    fields = schema["properties"]["listing"]["properties"]
    assert "UTF-8 bytes" in fields["keywords"]["properties"]["text"]["description"]
    assert "30 characters" in fields["subtitle"]["properties"]["text"]["description"]
    assert "apple-search" in requirements["keywords"]["allowed_source_ids"]
    assert "apple-search" not in requirements["subtitle"]["allowed_source_ids"]
    for field, limits in requirements.items():
        assert limits["official_source_ids"]
        assert (
            fields[field]["properties"]["source_ids"]["items"]["enum"]
            == limits["allowed_source_ids"]
        )
    assert proposal.SCHEMA == original
    output = writing()
    output["result"]["listing"]["keywords"]["text"] = "é" * 50
    assert proposal.validate(output, task.inputs)


@pytest.mark.parametrize("valid", [False, True])
def test_retry_after_cancellation_before_validation_reuses_only_valid_writing(
    api, workspace, run, valid
):
    task, _ = run
    token = services.claim(task.workflow_id)
    services.start_step(task.workflow_id, token, "project", "Loading")
    services.complete_step(task.workflow_id, token, "project", "Loaded", {"snapshot_id": "test"})
    services.start_step(task.workflow_id, token, "strategy", "Writing")
    output = writing()
    if not valid:
        output["result"]["listing"]["subtitle"]["text"] = "x" * 31
    services.complete_step(task.workflow_id, token, "strategy", "Written", output)
    services.cancel(task.workflow_id)
    services.fail(task.workflow_id, "Stopped", token)
    response = api.post(
        f"/api/workspaces/{workspace.pk}/aso/runs/{task.pk}/retry/",
        {"request_id": str(uuid.uuid4())},
        format="json",
    )
    assert response.status_code == 202, response.data
    retry = AuditRun.objects.get(pk=response.data["id"])
    assert bool(retry.workflow.steps.get(key="strategy").reused_from_id) == valid
    with patch.object(
        editorial,
        "generate",
        side_effect=[verification()] if valid else [writing(), verification()],
    ) as model:
        audit_listing(str(retry.workflow_id))
    retry.refresh_from_db()
    assert retry.workflow.status == "succeeded", retry.workflow.error
    assert model.call_count == (1 if valid else 2)


@pytest.mark.parametrize("rejected", ["analysis", "description"])
def test_unsupported_proposal_is_withheld_and_cannot_seed_a_draft(api, workspace, run, rejected):
    task, _ = run
    with patch.object(editorial, "generate", side_effect=[writing(), verification(rejected)]):
        audit_listing(str(task.workflow_id))
    task.refresh_from_db()
    assert task.workflow.status == "succeeded"
    assert not task.report["project"]["accepted"]
    assert task.report["project"]["fields"] == []
    response = api.post(
        f"/api/workspaces/{workspace.pk}/aso/apps/{task.app_id}/drafts/",
        {
            "request_id": str(uuid.uuid4()),
            "name": "Unsafe",
            "audit_id": str(task.pk),
            "check_id": "project.listing",
        },
        format="json",
    )
    assert response.status_code == 400 and not ListingDraft.objects.exists()


def test_incomplete_evidence_review_fails_before_report_is_saved(run):
    task, _ = run
    malformed = verification()
    malformed["result"]["reviews"].pop()
    with patch.object(editorial, "generate", side_effect=[writing(), malformed]):
        audit_listing(str(task.workflow_id))
    task.refresh_from_db()
    assert task.workflow.status == "failed" and task.report is None


def test_review_hash_includes_project_and_proposal(run):
    task, _ = run
    candidate = proposal.validate(writing(), task.inputs)
    with patch.object(editorial, "generate", return_value=verification()):
        checked = proposal.review(task, candidate)
    changed = copy.deepcopy(candidate)
    changed["listing"]["description"]["text"] = "A different description."
    with pytest.raises(ProviderError, match="incomplete"):
        proposal.report(task, writing(), changed, checked)
    task.inputs["app_context"]["specification"] = "A different idea."
    with pytest.raises(ProviderError, match="incomplete"):
        proposal.report(task, writing(), candidate, checked)


def test_project_requires_model_and_rejects_store_mode_confusion(
    api, workspace, project, connection
):
    activate_modules(workspace, ["aso"])
    app = MobileApp.objects.get(pk=project[0]["id"])
    base = f"/api/workspaces/{workspace.pk}/aso/"
    body = {
        "request_id": str(uuid.uuid4()),
        "snapshot_id": str(app.snapshots.first().pk),
        "locale": "fr-CA",
    }
    denied = api.post(f"{base}apps/{app.pk}/runs/", body, format="json")
    assert denied.status_code == 400 and "AI provider" in str(denied.data)
    app.origin = "store"
    app.platform = "ios"
    app.save()
    denied, _ = start(api, workspace, (app, app.snapshots.first()), locale="fr-CA", mode="project")
    assert denied.status_code == 400


def test_viewers_can_read_completed_proposals_but_not_create_drafts(api, owner, workspace, run):
    task, _ = run
    finish(task)
    Membership.objects.filter(workspace=workspace, user=owner).update(role="viewer")
    base = f"/api/workspaces/{workspace.pk}/aso/apps/{task.app_id}/"
    assert api.get(base + "runs/").status_code == 200
    assert (
        api.post(
            base + "drafts/",
            {
                "request_id": str(uuid.uuid4()),
                "name": "No access",
                "audit_id": str(task.pk),
                "check_id": "project.listing",
            },
            format="json",
        ).status_code
        == 403
    )
