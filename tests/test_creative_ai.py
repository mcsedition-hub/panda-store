import copy
import os
import subprocess
import sys
import uuid
from unittest.mock import patch

import pytest

from addons.app_catalog.models import MobileApp
from addons.studio import creative_ai as ai
from addons.studio.creative_tasks import generate_ai_scripts
from addons.studio.models import GenerationRun, ResearchPage, ResearchRun
from panda_store.ai.providers import ProviderError
from panda_store.core.credentials import encrypt
from panda_store.core.models import AIConnection, Membership, Workspace
from panda_store.workflows import services


def test_celery_discovers_all_studio_tasks_without_loading_urls():
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import django; django.setup(); "
            "from panda_store.celery import app; app.autodiscover_tasks(force=True); "
            "assert {'addons.studio.tasks.generate_scripts', "
            "'addons.studio.creative_tasks.generate_ai_scripts', "
            "'addons.studio.render_tasks.render_video', "
            "'addons.studio.research_tasks.research'} <= set(app.tasks)",
        ],
        env={**os.environ, "DJANGO_SETTINGS_MODULE": "panda_store.settings_test"},
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert result.returncode == 0, result.stderr


@pytest.fixture
def creative_setup(api, workspace, imported, settings):
    settings.PANDA_WORKFLOW_DISPATCH = "database"
    settings.PANDA_DEMO_MODE = False
    app = MobileApp.objects.get(pk=imported["id"])
    workflow = services.create_run(
        workspace=workspace,
        user=None,
        module_id="studio",
        key="studio.research",
        version=1,
        title="Fixture research",
        steps=[{"key": "fixture", "title": "Fixture", "kind": "storage", "depends_on": []}],
    )
    token = services.claim(workflow.pk)
    services.start_step(workflow.pk, token, "fixture", "Fixture")
    services.complete_step(workflow.pk, token, "fixture", "Fixture")
    services.succeed(workflow.pk, token)
    research = ResearchRun.objects.create(
        workspace=workspace,
        app=app,
        workflow=workflow,
        request_id=uuid.uuid4(),
        request={},
        inputs={},
    )
    page = ResearchPage.objects.create(
        run=research,
        position=0,
        status="observed",
        source={"url": "https://public.example/", "title": "Example", "kind": "discovered"},
        final_url="https://public.example/",
        title="Example",
        text="A short run.",
    )
    research.report = {
        "findings": [
            {
                "page_id": str(page.pk),
                "observation": "One small action.",
                "structure": "A prompt and demonstration.",
                "idea_to_test": "A single action.",
                "evidence_quotes": ["A short run."],
            }
        ]
    }
    research.save()
    AIConnection.objects.create(
        workspace=workspace,
        provider="openai",
        encrypted_key=encrypt("test-key"),
        model_catalog=[{"id": "gpt-4.1-mini"}],
    )
    body = {
        "request_id": str(uuid.uuid4()),
        "snapshot_id": str(app.snapshots.first().pk),
        "research_id": str(research.pk),
        "page_ids": [str(page.pk)],
        "provider": "openai",
        "model": "gpt-4.1-mini",
        "facts_confirmed": True,
        "brief": {
            "audience": "Beginner runners",
            "goal": "Try the app",
            "tone": "Simple",
            "language": "English",
            "duration_seconds": 30,
            "product_facts": "Runclub has running plans.",
        },
    }
    base = f"/api/workspaces/{workspace.pk}/studio/"
    return app, research, body, base


def proposals(inputs):
    return {
        "result": {
            "scripts": [
                {
                    "variant": n,
                    "angle": f"Direction {n}",
                    "hook": f"A new starting point {n}",
                    "script": [
                        "Film the plan screen, with a finger pointing to the first step. "
                        "Runclub has running plans.",
                        "Open on shoes by the door. Cut to a calendar and a choice of training "
                        "days. Runclub has running plans.",
                        "Text card: Where should a beginner start? Answer by opening a plan "
                        "and showing the first session. Runclub has running plans.",
                    ][n - 1],
                    "cta": "Explore Runclub",
                    "source_page_ids": [inputs["sources"][0]["page_id"]],
                    "adaptation": "Demonstrate one small action with original visuals.",
                    "product_claims": [
                        {
                            "claim": "Runclub has running plans.",
                            "fact_quote": "Runclub has running plans.",
                        }
                    ],
                }
                for n in (1, 2, 3)
            ]
        },
        "usage": {"input_tokens": 30, "output_tokens": 100},
    }


def review(supported=True):
    return {
        "result": {
            "checks": [
                {
                    "variant": n,
                    "supported": supported,
                    "reason": "Supported by the confirmed facts."
                    if supported
                    else "Invented price.",
                }
                for n in (1, 2, 3)
            ]
        },
        "usage": {"input_tokens": 100, "output_tokens": 30},
    }


def create(api, setup):
    app, research, body, base = setup
    response = api.post(f"{base}apps/{app.pk}/ai-runs/", body, format="json")
    assert response.status_code == 202, response.data
    return GenerationRun.objects.get(pk=response.data["id"])


def test_selected_research_saved_in_brief(api, creative_setup):
    app, research, body, base = creative_setup
    payload = {**body["brief"], "research": str(research.pk), "research_page_ids": body["page_ids"]}
    response = api.put(f"{base}apps/{app.pk}/brief/", payload, format="json")
    assert response.status_code == 200, response.data
    assert response.data["research"] == str(research.pk)
    assert response.data["research_sources"][0]["url"] == "https://public.example/"
    assert api.get(f"{base}apps/{app.pk}/brief/").data == response.data
    invalid = {**payload, "research_page_ids": [str(uuid.uuid4())]}
    assert api.put(f"{base}apps/{app.pk}/brief/", invalid, format="json").status_code == 400


def test_ai_scripts_with_demo_disabled_edit_approve_export(api, creative_setup):
    run = create(api, creative_setup)
    with patch.object(ai, "call", side_effect=[proposals(run.inputs), review()]) as model:
        generate_ai_scripts(str(run.pk))
        generate_ai_scripts(str(run.pk))
    run.refresh_from_db()
    assert run.status == "succeeded" and run.creatives.count() == 3 and model.call_count == 2
    assert run.review["calls"][0]["usage"]["input_tokens"] == 30
    app, research, body, base = creative_setup
    data = api.get(f"{base}apps/{app.pk}/runs/").data[0]
    assert data["context"]["sources"][0]["page_id"] == body["page_ids"][0]
    assert "connection_id" not in str(data) and "test-key" not in str(data)
    creative = run.creatives.first()
    endpoint = f"{base}creatives/{creative.pk}/"
    assert api.patch(endpoint, {"approved": True}, format="json").data["approved"]
    edited = api.patch(endpoint, {"hook": "My edit", "approved": True}, format="json").data
    assert not edited["approved"] and edited["provenance"] == creative.provenance
    text = api.get(f"{base}runs/{run.pk}/export/").content.decode()
    assert "AI drafts: openai" in text and "https://public.example/" in text
    assert "My edit" in text and "Demo mode" not in text


def test_replay_keeps_exact_inputs_without_credentials_or_new_snapshot(api, creative_setup):
    run = create(api, creative_setup)
    app, research, body, base = creative_setup
    AIConnection.objects.all().delete()
    research.report = {"findings": []}
    research.save()
    endpoint = f"{base}apps/{app.pk}/ai-runs/"
    assert api.post(endpoint, body, format="json").data["id"] == str(run.pk)
    assert api.post(endpoint, {**body, "model": "changed"}, format="json").status_code == 409
    assert (
        api.post(endpoint, {**body, "request_id": str(uuid.uuid4())}, format="json").status_code
        == 400
    )
    assert run.inputs["sources"][0]["finding"]["observation"] == "One small action."


@pytest.mark.parametrize(
    "change",
    [
        {"facts_confirmed": False},
        {"model": "missing"},
        {"page_ids": []},
        {"page_ids": [str(uuid.uuid4())]},
        {"research_id": str(uuid.uuid4())},
        {"snapshot_id": str(uuid.uuid4())},
    ],
)
def test_invalid_inputs_do_not_create_a_paid_run(api, creative_setup, change):
    app, research, body, base = creative_setup
    response = api.post(f"{base}apps/{app.pk}/ai-runs/", {**body, **change}, format="json")
    assert response.status_code in {400, 404}
    assert not GenerationRun.objects.exists()


def test_rejected_review_blocks_output_and_retry(api, creative_setup):
    run = create(api, creative_setup)
    with patch.object(ai, "call", side_effect=[proposals(run.inputs), review(False)]):
        generate_ai_scripts(str(run.pk))
    run.refresh_from_db()
    assert run.status == "failed" and not run.creatives.exists()
    assert run.review["rejected"] and run.review["checks"][0]["reason"] == "Invented price."
    response = api.post(
        f"{creative_setup[-1]}runs/{run.pk}/retry/",
        {"request_id": str(uuid.uuid4())},
        format="json",
    )
    assert response.status_code == 400 and "new generation" in str(response.data)


def test_timeout_retry_reuses_writing_and_never_switches_provider(api, creative_setup):
    original = create(api, creative_setup)
    with patch.object(
        ai,
        "call",
        side_effect=[
            proposals(original.inputs),
            ProviderError("Provider timed out.", code="timeout"),
        ],
    ):
        generate_ai_scripts(str(original.pk))
    original.refresh_from_db()
    assert original.status == "failed" and not original.creatives.exists()
    response = api.post(
        f"{creative_setup[-1]}runs/{original.pk}/retry/",
        {"request_id": str(uuid.uuid4())},
        format="json",
    )
    assert response.status_code == 202, response.data
    retry = GenerationRun.objects.get(pk=response.data["id"])
    with patch.object(ai, "call", return_value=review()) as model:
        generate_ai_scripts(str(retry.pk))
    retry.refresh_from_db()
    assert retry.status == "succeeded" and model.call_count == 1
    assert retry.provider == "openai" and retry.inputs == original.inputs
    assert retry.workflow.steps.get(key="scripts").reused_from_id


def test_cancellation_discards_late_response(api, creative_setup):
    run = create(api, creative_setup)

    def cancel(*args):
        services.cancel(run.workflow_id)
        return proposals(run.inputs)

    with patch.object(ai, "call", side_effect=cancel):
        generate_ai_scripts(str(run.pk))
    run.refresh_from_db()
    assert run.status == "canceled" and not run.creatives.exists()
    assert run.workflow.steps.get(key="scripts").output is None


def test_connection_rotation_fails_before_ai(api, creative_setup):
    run = create(api, creative_setup)
    AIConnection.objects.update(revision=uuid.uuid4())
    with patch.object(ai, "call") as model:
        generate_ai_scripts(str(run.pk))
    run.refresh_from_db()
    assert run.status == "failed" and "connection changed" in run.error
    model.assert_not_called()


def test_roles_workspace_and_module_restrictions(api, workspace, owner, creative_setup):
    app, research, body, base = creative_setup
    Membership.objects.filter(workspace=workspace).update(role="viewer")
    assert api.post(f"{base}apps/{app.pk}/ai-runs/", body, format="json").status_code == 403
    Membership.objects.filter(workspace=workspace).update(role="owner")
    other = Workspace.objects.create(name="Other")
    research.workspace = other
    research.save()
    assert api.post(f"{base}apps/{app.pk}/ai-runs/", body, format="json").status_code == 400
    research.workspace = workspace
    research.save()
    run = create(api, creative_setup)
    workspace.modules.filter(module_id="studio").delete()
    with patch.object(ai, "call") as model:
        generate_ai_scripts(str(run.pk))
    assert api.post(f"{base}apps/{app.pk}/ai-runs/", body, format="json").status_code == 403
    model.assert_not_called()


@pytest.mark.parametrize(
    "change", ["claim", "source", "duplicate", "same_script", "missing", "malformed"]
)
def test_bad_proposals_rejected_before_review(api, creative_setup, change):
    run = create(api, creative_setup)
    data = proposals(run.inputs)
    scripts = data["result"]["scripts"]
    if change == "claim":
        scripts[0]["product_claims"][0]["fact_quote"] = "Free forever."
    if change == "source":
        scripts[0]["source_page_ids"] = ["invented"]
    if change == "duplicate":
        scripts[1]["hook"] = scripts[0]["hook"]
    if change == "same_script":
        scripts[1]["script"] = scripts[0]["script"]
    if change == "missing":
        scripts.pop()
    if change == "malformed":
        scripts[0]["product_claims"] = None
    with patch.object(ai, "call", return_value=data) as model:
        generate_ai_scripts(str(run.pk))
    run.refresh_from_db()
    assert run.status == "failed" and not run.creatives.exists() and model.call_count == 1


def test_incomplete_review_rejected():
    data = copy.deepcopy(review())
    data["result"]["checks"][1]["variant"] = 1
    with pytest.raises(ProviderError):
        ai.validate_review(data)
