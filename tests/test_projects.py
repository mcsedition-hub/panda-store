"""Projects can start without a store and retain their stage in frozen AI work."""

import copy
import json
import uuid
from unittest.mock import patch

import pytest

from addons.app_catalog.models import MetadataSnapshot, MobileApp
from addons.aso import editorial
from addons.aso import project as aso_project
from addons.aso.models import AuditRun
from addons.studio import (
    creative_ai,
    research_analysis,
    research_search,
    research_tasks,
    social_tasks,
)
from addons.studio.models import GenerationRun, SocialResearch
from panda_store.ai import providers
from panda_store.ai.context import project_instruction
from panda_store.core.access import activate_modules
from panda_store.core.models import Membership, Workspace
from tests.test_ai import connection as ai_connection
from tests.test_ai import start
from tests.test_creative_ai import create
from tests.test_creative_ai import creative_setup as script_setup
from tests.test_research import runner_mocks as research_mocks
from tests.test_research import setup as page_setup
from tests.test_social_research import collect, fake_analysis
from tests.test_social_research import setup as social_setup

connection = ai_connection
creative_setup = script_setup
research_setup = page_setup
runner_mocks = research_mocks
setup = social_setup
real_research_call = research_analysis.call


@pytest.fixture
def project(api, workspace, settings):
    settings.PANDA_WORKFLOW_DISPATCH = "database"
    body = {
        "request_id": str(uuid.uuid4()),
        "name": "Carnet de course",
        "platform": "undecided",
        "stage": "idea",
        "locale": "fr-CA",
        "specification": "# Concept\n"
        + "Des plans de course sont envisagés. " * 300
        + "\nFin du document.",
        "audience": "Débutants en course à pied",
    }
    url = f"/api/workspaces/{workspace.pk}/app_catalog/projects/"
    response = api.post(url, body, format="json")
    assert response.status_code == 201, response.data
    return response.data, body, url


@pytest.fixture
def imported(project):
    # Existing workflow fixtures now exercise an actual API-created, unpublished project.
    return project[0]


def edit(api, project, **changes):
    saved, original, url = project
    body = {k: v for k, v in original.items() if k != "request_id"}
    body.update(snapshot_id=saved["metadata"]["id"], **changes)
    return api.put(f"{url}{saved['id']}/", body, format="json"), body


def test_project_roundtrip_does_not_require_store_connections(api, workspace, project):
    saved, body, url = project
    assert saved["origin"] == "project" and saved["platform"] == "undecided"
    assert not saved["is_demo"] and not saved["sync_provider"] and not saved["bundle_id"]
    metadata = saved["metadata"]
    assert metadata["source"] == "project.manual"
    assert metadata["data"]["description"] == ""
    assert metadata["data"]["project"]["specification"] == body["specification"]
    assert metadata["data"]["project"]["listing_ready"] is False
    replay = api.post(url, body, format="json")
    assert replay.status_code == 200 and replay.data["id"] == saved["id"]
    conflict = api.post(url, {**body, "name": "Autre idée"}, format="json")
    assert conflict.status_code == 409
    assert MobileApp.objects.filter(workspace=workspace).count() == 1
    assert api.get(url.replace("projects/", "apps/")).data == [saved]


def test_project_works_with_only_catalog_module(api, owner):
    workspace = Workspace.objects.create(name="No store accounts")
    Membership.objects.create(workspace=workspace, user=owner, role="owner")
    activate_modules(workspace, ["app_catalog"])
    response = api.post(
        f"/api/workspaces/{workspace.pk}/app_catalog/projects/",
        {
            "request_id": str(uuid.uuid4()),
            "name": "Idea",
            "platform": "undecided",
            "stage": "idea",
            "locale": "en-US",
            "specification": "An idea for a future running app.",
        },
        format="json",
    )
    assert response.status_code == 201, response.data


def test_edits_create_snapshots_and_detect_stale_writes(api, project):
    saved, original, url = project
    response, body = edit(
        api,
        project,
        stage="development",
        platform="ios",
        available_features="Un calendrier fonctionne dans le prototype.",
    )
    assert response.status_code == 200, response.data
    assert response.data["metadata"]["id"] != saved["metadata"]["id"]
    old = MetadataSnapshot.objects.get(pk=saved["metadata"]["id"])
    assert old.data["project"]["stage"] == "idea"
    assert api.put(f"{url}{saved['id']}/", body, format="json").status_code == 200
    conflict, _ = edit(api, project, name="Stale edit")
    assert conflict.status_code == 409
    assert MetadataSnapshot.objects.filter(app_id=saved["id"]).count() == 2
    # An ambiguous create response can be retried even after a platform change.
    replay = api.post(url, original, format="json")
    assert replay.status_code == 200 and replay.data == response.data


@pytest.mark.parametrize(
    "change",
    [
        {"specification": "short"},
        {"specification": "x" * 20001},
        {"specification": "A project description with\x00binary content"},
        {"locale": "not a locale"},
        {"platform": "web"},
        {"stage": "published"},
        {"available_features": "Already works"},
        {"listing": {"description": "x" * 8001}},
    ],
)
def test_project_validation_does_not_write_invalid_data(api, project, change):
    saved, body, url = project
    before = MetadataSnapshot.objects.count()
    response = api.post(url, {**body, "request_id": str(uuid.uuid4()), **change}, format="json")
    assert response.status_code == 400, response.data
    assert MetadataSnapshot.objects.count() == before


def test_project_markdown_is_preserved_without_parsing_or_fetching(api, project):
    specification = '# Title\n<script>alert("demo")</script>\n![image](https://localhost/private)'
    response, _ = edit(api, project, specification=specification)
    assert response.status_code == 200
    assert response.data["metadata"]["data"]["project"]["specification"] == specification


def test_project_permissions_and_store_isolation(api, owner, workspace, project):
    saved, body, url = project
    Membership.objects.filter(user=owner, workspace=workspace).update(role="viewer")
    assert api.post(url, body, format="json").status_code == 403
    assert edit(api, project, name="Viewer edit")[0].status_code == 403
    assert api.get(url.replace("projects/", "apps/")).status_code == 200
    Membership.objects.filter(user=owner, workspace=workspace).update(role="owner")
    store = MobileApp.objects.create(
        workspace=workspace, name="Imported app", platform="ios", external_id="123"
    )
    update_body = {**body, "snapshot_id": saved["metadata"]["id"]}
    assert api.put(f"{url}{store.pk}/", update_body, format="json").status_code == 404
    other = Workspace.objects.create(name="Other workspace")
    Membership.objects.create(user=owner, workspace=other, role="owner")
    activate_modules(other, ["app_catalog"])
    assert (
        api.put(
            f"/api/workspaces/{other.pk}/app_catalog/projects/{saved['id']}/",
            update_body,
            format="json",
        ).status_code
        == 404
    )


def test_project_brief_is_launch_preparation_and_demo_templates_are_blocked(api, owner, project):
    saved, _, url = project
    owner.language = "fr"
    owner.save(update_fields=["language"])
    studio = url.replace("app_catalog/projects/", f"studio/apps/{saved['id']}/")
    brief = api.get(studio + "brief/").data
    assert brief["goal"] == "Donner envie d’essayer l’application."
    assert brief["audience"] == saved["metadata"]["data"]["project"]["audience"]
    assert brief["product_facts"] == saved["metadata"]["data"]["project"]["specification"][:4000]
    response = api.post(studio + "runs/", {"request_id": str(uuid.uuid4())}, format="json")
    assert response.status_code == 400
    assert not GenerationRun.objects.exists()


def test_aso_starts_directly_from_idea_and_keeps_project_context(
    api, workspace, project, connection
):
    activate_modules(workspace, ["aso"])
    app = MobileApp.objects.get(pk=project[0]["id"])
    audit, _ = start(api, workspace, (app, app.snapshots.first()), locale="fr-CA")
    assert audit.status_code == 202, audit.data
    run = AuditRun.objects.get(pk=audit.data["id"])
    frozen = copy.deepcopy(run.inputs["app_context"])
    assert run.inputs["source"] == "project.manual"
    assert run.inputs["mode"] == "project"
    assert run.inputs["platform"] == "ios"
    assert run.inputs["metadata"]["description"] == ""
    with patch.object(editorial, "generate", return_value={}) as generate:
        editorial.call(run, "Review", {}, {}, max_output_tokens=500)
        editorial.call(run, "Verify", {}, {}, max_output_tokens=500)
    assert all(c.args[4]["app_context"] == frozen for c in generate.call_args_list)


def test_public_research_freezes_full_spec_for_search_analysis_and_verification(
    api, project, research_setup, runner_mocks
):
    base, app, body, run = research_setup
    frozen = copy.deepcopy(run.inputs["app_context"])
    assert len(frozen["specification"]) > 8000
    response, _ = edit(api, project, specification="A different concept for a future app.")
    assert response.status_code == 200
    research_tasks.research(str(run.workflow_id))
    run.refresh_from_db()
    assert run.workflow.status == "succeeded", run.workflow.error
    assert runner_mocks[1].call_args.args[3]["app_context"] == frozen
    with patch.object(research_analysis, "generate", return_value={}) as generate:
        real_research_call(run, run.pages.all())
        real_research_call(run, run.pages.all(), findings=[])
    assert all(c.args[4]["app_context"] == frozen for c in generate.call_args_list)
    assert api.post(f"{base}apps/{app.pk}/research/", body, format="json").data["id"] == str(run.pk)


def test_script_generation_and_review_keep_frozen_project_after_edit(api, project, creative_setup):
    run = create(api, creative_setup)
    frozen = copy.deepcopy(run.inputs["app_context"])
    assert frozen["stage"] == "idea"
    assert (
        edit(api, project, stage="development", available_features="A working calendar.")[
            0
        ].status_code
        == 200
    )
    with patch.object(creative_ai, "generate", return_value={}) as generate:
        creative_ai.call(run)
        creative_ai.call(run, scripts=[])
    assert all(c.args[4]["app_context"] == frozen for c in generate.call_args_list)
    assert all(c.args[4]["purpose"] == "smm_launch" for c in generate.call_args_list)
    base = creative_setup[-1]
    history = api.get(f"{base}apps/{run.app_id}/runs/")
    assert history.data[0]["context"]["app_context"] == frozen
    run.status = "succeeded"
    run.save(update_fields=["status"])
    exported = api.get(f"{base}runs/{run.pk}/export/")
    assert exported.status_code == 200
    text = exported.content.decode()
    assert "Stage when generated: idea" in text
    assert frozen["specification"] in text
    assert "A working calendar." not in text


@pytest.mark.parametrize(
    "goal,expected",
    [
        (
            "Present the unpublished concept and gather feedback.",
            "Encourage people to try the app.",
        ),
        ("Présenter le concept et recueillir des retours.", "Encourage people to try the app."),
        ("Ask which meal is hardest to plan.", "Ask which meal is hardest to plan."),
    ],
)
def test_social_plan_analysis_verification_and_adaptation_keep_project_stage(
    api, project, setup, goal, expected
):
    base, app, body, session = setup
    session.inputs["brief"]["goal"] = goal
    session.save(update_fields=["inputs"])
    saved_inputs = copy.deepcopy(session.inputs)
    frozen = copy.deepcopy(session.inputs["app_context"])
    assert (
        edit(api, project, stage="development", available_features="A working calendar.")[
            0
        ].status_code
        == 200
    )
    with patch.object(social_tasks, "generate", return_value={}) as generate:
        for instruction in (
            social_tasks.PLAN_INSTRUCTION,
            social_tasks.ANALYZE_INSTRUCTION,
            social_tasks.VERIFY_INSTRUCTION,
        ):
            social_tasks.call(session, instruction, {"brief": session.inputs["brief"]}, {})
    assert all(c.args[4]["app_context"] == frozen for c in generate.call_args_list)
    assert all(c.args[4]["purpose"] == "smm_launch" for c in generate.call_args_list)
    url = collect(api, base, session)
    finished = api.post(url, {"action": "finish"}, format="json")
    with patch.object(social_tasks, "call", side_effect=fake_analysis):
        social_tasks.research(finished.data["workflow_id"])
    posts = session.posts.filter(qualification__status="qualified")
    adapted = api.post(
        url + "adapt/",
        {"request_id": str(uuid.uuid4()), "post_ids": [str(p.pk) for p in posts]},
        format="json",
    )
    assert adapted.status_code == 202, adapted.data
    run = GenerationRun.objects.get(pk=adapted.data["id"])
    assert run.inputs["brief"] == {**saved_inputs["brief"], "goal": expected}
    assert {s["page_id"] for s in run.inputs["sources"]} == {str(p.pk) for p in posts}
    session.refresh_from_db()
    assert session.inputs == saved_inputs
    with patch.object(creative_ai, "generate", return_value={}) as generate:
        creative_ai.call(run)
        creative_ai.call(run, scripts=[])
    assert all(c.args[4]["app_context"] == frozen for c in generate.call_args_list)
    assert all(c.args[4]["purpose"] == "smm_launch" for c in generate.call_args_list)


def test_social_research_accepts_prefilled_idea_brief_and_keeps_the_complete_description(
    api, setup
):
    base, app, body, _ = setup
    assert app.origin == "project" and app.platform == "undecided"
    snapshot = app.snapshots.first()
    assert not snapshot.data.get("features") and not snapshot.data["description"]
    brief = api.get(f"{base}apps/{app.pk}/brief/").data
    assert len(brief["product_facts"]) == 4000
    response = api.post(
        f"{base}apps/{app.pk}/social-research/",
        {**body, "request_id": str(uuid.uuid4()), "brief": brief},
        format="json",
    )
    assert response.status_code == 202, response.data
    session = SocialResearch.objects.get(pk=response.data["id"])
    assert session.inputs["brief"]["product_facts"] == brief["product_facts"]
    assert (
        session.inputs["app_context"]["specification"] == snapshot.data["project"]["specification"]
    )
    assert session.inputs["app_context"]["specification"].endswith("Fin du document.")


@pytest.mark.parametrize(
    "provider,model",
    [
        ("openai", "gpt-4.1-mini"),
        ("google", "gemini-2.5-flash"),
        ("anthropic", "claude-sonnet-4-20250514"),
        ("zai", "glm-4.7-flash"),
    ],
)
def test_every_provider_receives_unpublished_rules_and_full_spec(provider, model):
    context = {
        "app_context": {
            "origin": "project",
            "stage": "idea",
            "specification": "Untrusted idea text.",
        }
    }
    with patch.object(providers, "request", side_effect=RuntimeError("captured")) as request:
        with pytest.raises(RuntimeError, match="captured"):
            providers.generate(
                provider, "fake-key", model, "Write scripts.", context, {}, response_language="fr"
            )
    payload = json.dumps(request.call_args.kwargs["payload"], ensure_ascii=False)
    for expected in (
        "Unpublished project context",
        "Never invite people to download",
        "French (fr)",
        "Untrusted idea text.",
    ):
        assert expected in payload
    assert project_instruction("Original", {"app_context": {}}) == "Original"


@pytest.mark.parametrize(
    "provider,model",
    [
        ("openai", "gpt-4.1-mini"),
        ("google", "gemini-2.5-flash"),
        ("anthropic", "claude-sonnet-4-20250514"),
        ("zai", "glm-4.7-flash"),
    ],
)
@pytest.mark.parametrize(
    "instruction", [aso_project.INSTRUCTION, aso_project.VERIFY], ids=["write", "review"]
)
def test_aso_writing_and_review_use_launch_copy_rules_for_every_provider(
    provider, model, instruction
):
    context = {
        "purpose": "aso_project",
        "app_context": {
            "origin": "project",
            "stage": "idea",
            "specification": "Planned recipe suggestions using ingredients in the fridge.",
        },
    }
    with patch.object(providers, "request", side_effect=RuntimeError("captured")) as request:
        with pytest.raises(RuntimeError, match="captured"):
            providers.generate(
                provider, "fake-key", model, instruction, context, {}, response_language="fr"
            )
    payload = json.dumps(request.call_args.kwargs["payload"], ensure_ascii=False)
    assert "Store publication copy from a project specification" in payload
    assert "a documented\\nplanned feature written in the present tense is supported" in payload
    assert "Planned recipe suggestions using ingredients in the fridge." in payload
    assert "French (fr)" in payload
    assert "retain prospective wording" not in payload
    assert "Never invite people to download" not in payload


@pytest.mark.parametrize(
    "provider,model",
    [
        ("openai", "gpt-4.1-mini"),
        ("google", "gemini-2.5-flash"),
        ("anthropic", "claude-sonnet-4-20250514"),
        ("zai", "glm-4.7-flash"),
    ],
)
@pytest.mark.parametrize(
    "instruction",
    [creative_ai.SOCIAL_INSTRUCTION, creative_ai.SOCIAL_VERIFY],
    ids=["write", "review"],
)
def test_smm_writing_and_review_use_launch_copy_rules_for_every_provider(
    provider, model, instruction
):
    context = {
        "purpose": "smm_launch",
        "app_context": {
            "origin": "project",
            "stage": "idea",
            "specification": "The app would suggest recipes from ingredients entered manually.",
        },
        "brief": {
            "product_facts": "The app would suggest recipes from ingredients entered manually."
        },
    }
    with patch.object(providers, "request", side_effect=RuntimeError("captured")) as request:
        with pytest.raises(RuntimeError, match="captured"):
            providers.generate(
                provider, "fake-key", model, instruction, context, {}, response_language="fr"
            )
    payload = json.dumps(request.call_args.kwargs["payload"], ensure_ascii=False)
    assert "Marketing publication copy from a project specification" in payload
    assert "paraphrasing the claim into present tense is valid" in payload
    assert "The app would suggest recipes from ingredients entered manually." in payload
    assert "French (fr)" in payload
    assert "retain prospective wording" not in payload
    assert "Never invite people to download" not in payload
    assert "clearly conditional on implementation" not in payload


@pytest.mark.parametrize(
    "provider,model",
    [
        ("openai", "gpt-4.1-mini"),
        ("google", "gemini-2.5-flash"),
        ("anthropic", "claude-sonnet-4-20250514"),
    ],
)
def test_web_discovery_receives_project_rules(provider, model):
    with patch.object(research_search, "request", side_effect=RuntimeError("captured")) as request:
        with pytest.raises(RuntimeError, match="captured"):
            research_search.search(
                provider, "fake-key", model, {"app_context": {"origin": "project", "stage": "idea"}}
            )
    assert "Unpublished project context" in json.dumps(request.call_args.kwargs["payload"])
