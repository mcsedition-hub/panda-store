import copy
import uuid
from unittest.mock import patch

import httpx
import pytest
from rest_framework.test import APIClient

from addons.app_catalog.models import MetadataSnapshot, MobileApp
from addons.aso import editorial, grounding
from addons.aso.models import AuditRun
from addons.aso.rules import RULESET, audit
from addons.aso.tasks import audit_listing
from panda_store.ai import providers
from panda_store.core.access import activate_modules
from panda_store.core.credentials import decrypt, encrypt
from panda_store.core.models import AIConnection, Membership, Workspace
from panda_store.workflows import services
from tests.aso_support import provider

KEY = "test-key-never-real-12345"
MODELS = [{"id": "gpt-4.1-mini", "name": "GPT"}]


def endpoint(workspace):
    return f"/api/workspaces/{workspace.pk}/ai/"


@pytest.fixture
def connection(workspace):
    return AIConnection.objects.create(
        workspace=workspace, provider="openai", encrypted_key=encrypt(KEY), model_catalog=MODELS
    )


@pytest.fixture
def listing(workspace):
    activate_modules(workspace, ["aso"])
    app = MobileApp.objects.create(
        workspace=workspace, name="Panda Run", platform="ios", external_id="run"
    )
    snapshot = MetadataSnapshot.objects.create(
        app=app,
        source="apple_store.api",
        fingerprint="initial",
        data={
            "locale": "en-US",
            "name": "Panda Run",
            "subtitle": "Your running companion",
            "description": "Plan runs and track your distance. Your data stays on your device.",
            "keywords": "fitness,training",
            "promotional_text": "Plan your next run.",
        },
    )
    return app, snapshot


def start(api, workspace, listing, **extra):
    app, snapshot = listing
    data = {
        "request_id": str(uuid.uuid4()),
        "snapshot_id": str(snapshot.pk),
        "locale": "en-US",
        "provider": "openai",
        "model": "gpt-4.1-mini",
        **extra,
    }
    response = api.post(
        f"/api/workspaces/{workspace.pk}/aso/apps/{app.pk}/runs/", data, format="json"
    )
    return response, data


def output():
    return {
        "result": {
            "assessments": {
                field: {
                    "verdict": "improve" if field == "subtitle" else "keep",
                    "observation": observation,
                    "evidence": [{"field": field, "quote": quote}],
                    "source_ids": ["apple-search" if field == "keywords" else "apple-product-page"],
                }
                for field, quote, observation in [
                    (
                        "name",
                        "Panda Run",
                        "The short brand name signals running without a vague superlative.",
                    ),
                    (
                        "subtitle",
                        "Your running companion",
                        "This phrase does not identify planning or distance tracking.",
                    ),
                    (
                        "description",
                        "Plan runs and track your distance.",
                        "The opening sentence identifies two concrete functions in plain language.",
                    ),
                    (
                        "keywords",
                        "fitness,training",
                        "These terms relate to running; demand and competition are unknown.",
                    ),
                    (
                        "promotional_text",
                        "Plan your next run.",
                        "The message points to the planning feature without inventing an offer.",
                    ),
                ]
            },
            "proposals": [
                {
                    "field": "subtitle",
                    "title": "Describe the running features",
                    "observation_quote": "Your running companion",
                    "rationale": (
                        "The subtitle is broad. Mentioning planning and distance "
                        "makes its purpose clearer."
                    ),
                    "replacement": "Plan runs & track distance",
                    "evidence": [
                        {"field": "description", "quote": "Plan runs and track your distance."}
                    ],
                    "source_ids": ["apple-product-page"],
                }
            ],
        },
        "provider": "openai",
        "model": "gpt-4.1-mini",
        "resolved_model": "gpt-4.1-mini-test",
        "usage": {"input_tokens": 300, "output_tokens": 150},
    }


def test_connection_encryption_roles_rotation_and_refresh(api, workspace, owner):
    url = endpoint(workspace)
    assert len(api.get(url).data["providers"]) == 3
    with patch("panda_store.ai.views.list_models", return_value=MODELS):
        response = api.put(url + "openai/", {"api_key": KEY}, format="json")
    assert response.status_code == 200 and KEY not in str(response.data)
    connection = AIConnection.objects.get(workspace=workspace)
    assert connection.encrypted_key != KEY and decrypt(connection.encrypted_key) == KEY
    revision = str(connection.revision)
    with patch("panda_store.ai.views.list_models", return_value=MODELS):
        assert api.post(url + "openai/", {"revision": revision}, format="json").status_code == 200
    connection.refresh_from_db()
    assert str(connection.revision) == revision
    assert api.put(url + "openai/", {"api_key": KEY}, format="json").status_code == 409
    for role in ["editor", "viewer"]:
        Membership.objects.filter(workspace=workspace).update(role=role)
        assert api.get(url).status_code == 200
        assert api.delete(url + "openai/", {"revision": revision}, format="json").status_code == 403
    other = Workspace.objects.create(name="Other")
    assert api.get(endpoint(other)).status_code == 404
    Membership.objects.filter(workspace=workspace).update(role="owner")
    with patch("panda_store.ai.views.list_models", return_value=MODELS):
        assert (
            api.put(
                url + "openai/", {"api_key": KEY + "-new", "revision": revision}, format="json"
            ).status_code
            == 200
        )
    connection.refresh_from_db()
    assert str(connection.revision) != revision
    assert (
        api.delete(
            url + "openai/", {"revision": str(connection.revision)}, format="json"
        ).status_code
        == 200
    )
    assert not AIConnection.objects.exists()
    client = APIClient(enforce_csrf_checks=True)
    client.force_login(owner)
    assert client.put(url + "google/", {"api_key": KEY}, format="json").status_code == 403


def test_connection_cannot_be_resurrected_during_model_refresh(api, workspace, connection):
    revision = str(connection.revision)

    def removed(*args):
        connection.delete()
        return MODELS

    with patch("panda_store.ai.views.list_models", side_effect=removed):
        response = api.post(endpoint(workspace) + "openai/", {"revision": revision}, format="json")
    assert response.status_code == 409 and not AIConnection.objects.exists()


@pytest.mark.parametrize("provider", ["openai", "google", "anthropic"])
def test_adapter_uses_official_endpoint_and_discards_provider_errors(provider):
    def handler(request):
        assert str(request.url).startswith(providers.HOSTS[provider])
        assert KEY not in str(request.url)
        return httpx.Response(429, json={"error": KEY})

    real_client = httpx.Client
    with patch(
        "panda_store.ai.providers.httpx.Client",
        side_effect=lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw),
    ):
        with pytest.raises(providers.ProviderError, match="quota") as error:
            providers.request(provider, KEY, "/models")
    assert KEY not in str(error.value)


def test_catalog_filters_media_models_and_paginates():
    with patch(
        "panda_store.ai.providers.request",
        side_effect=[
            {
                "models": [
                    {
                        "name": "models/gemini-2.5-flash",
                        "supportedGenerationMethods": ["generateContent"],
                        "thinking": True,
                    },
                    {
                        "name": "models/gemini-image",
                        "supportedGenerationMethods": ["generateContent"],
                    },
                ],
                "nextPageToken": "next",
            },
            {
                "models": [
                    {
                        "name": "models/gemini-2.5-pro",
                        "supportedGenerationMethods": ["generateContent"],
                    }
                ]
            },
        ],
    ) as call:
        models = providers.list_models("google", KEY)
    assert {item["id"] for item in models} == {"gemini-2.5-flash", "gemini-2.5-pro"}
    assert {item["id"]: item["thinking"] for item in models} == {
        "gemini-2.5-flash": True,
        "gemini-2.5-pro": None,
    }
    assert call.call_args.kwargs["params"]["pageToken"] == "next"
    assert not providers.supported("openai", "gpt-4o-audio-preview")
    assert not providers.supported("google", "../../secrets")


@pytest.mark.parametrize("thinking,expected", [(False, False), ("true", None)])
def test_google_catalog_does_not_infer_reasoning_from_a_model_name(thinking, expected):
    with patch(
        "panda_store.ai.providers.request",
        return_value={
            "models": [
                {
                    "name": "models/gemini-4-argon",
                    "supportedGenerationMethods": ["generateContent"],
                    "thinking": thinking,
                }
            ]
        },
    ):
        assert providers.list_models("google", KEY)[0]["thinking"] is expected


@pytest.mark.parametrize(
    "model,thinking_config",
    [
        ("gemini-4-argon", {"thinkingLevel": "medium"}),
        ("gemini-3.8-flash", {"thinkingLevel": "medium"}),
        ("gemini-2.5-flash", None),
    ],
)
def test_google_reasoning_config_and_truncated_response(model, thinking_config):
    with patch(
        "panda_store.ai.providers.request",
        return_value={
            "candidates": [
                {"finishReason": "MAX_TOKENS", "content": {"parts": [{"text": '{"proposals":'}]}}
            ]
        },
    ) as call:
        with pytest.raises(providers.ProviderError, match="did not finish"):
            providers.generate("google", KEY, model, "instruction", {}, editorial.SCHEMA)
    config = call.call_args.kwargs["payload"]["generationConfig"]
    assert config.get("thinkingConfig") == thinking_config
    assert config["maxOutputTokens"] == 6000
    assert call.call_count == 1


@pytest.mark.parametrize(
    "provider,model,response",
    [
        (
            "openai",
            "gpt-4.1-mini",
            {
                "status": "completed",
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": '{"proposals": []}'}],
                    }
                ],
                "usage": {"input_tokens": 20},
            },
        ),
        (
            "google",
            "gemini-2.5-flash",
            {
                "candidates": [
                    {"finishReason": "STOP", "content": {"parts": [{"text": '{"proposals": []}'}]}}
                ],
                "usageMetadata": {"promptTokenCount": 20},
            },
        ),
        (
            "anthropic",
            "claude-sonnet-4-5",
            {
                "stop_reason": "tool_use",
                "content": [
                    {"type": "tool_use", "name": "listing_review", "input": {"proposals": []}}
                ],
                "usage": {"input_tokens": 20},
            },
        ),
    ],
)
def test_structured_adapter_contract(provider, model, response):
    with patch("panda_store.ai.providers.request", return_value=response) as call:
        result = providers.generate(
            provider,
            KEY,
            model,
            "instruction",
            {"listing": "data"},
            editorial.SCHEMA,
            max_output_tokens=12000,
        )
    assert result["result"] == {"proposals": []} and result["usage"]["input_tokens"] == 20
    payload = call.call_args.kwargs["payload"]
    if provider == "openai":
        assert payload["store"] is False and payload["text"]["format"]["strict"]
        assert payload["max_output_tokens"] == 12000
    elif provider == "anthropic":
        assert payload["tool_choice"]["name"] == "listing_review"
        assert payload["max_tokens"] == 12000
    else:
        assert payload["generationConfig"]["responseMimeType"] == "application/json"
        assert payload["generationConfig"]["maxOutputTokens"] == 12000


def test_editorial_audit_freezes_choice_records_usage_and_creates_draft(
    api, workspace, listing, connection
):
    response, data = start(api, workspace, listing)
    assert response.status_code == 202
    run = AuditRun.objects.get(pk=response.data["id"])
    assert run.inputs["ai"]["model"] == "gpt-4.1-mini"
    assert KEY not in str(run.inputs)
    with patch("addons.aso.editorial.generate", side_effect=provider(output())) as generate:
        audit_listing(str(run.workflow_id))
        audit_listing(str(run.workflow_id))
    assert generate.call_count == 2
    run.refresh_from_db()
    assert run.workflow.status == "succeeded"
    assert run.report["editorial"]["accepted_proposals"] == 1
    assert run.report["editorial"]["usage"]["output_tokens"] == 150
    assert run.report["editorial"]["reviewed_fields"] == 5
    assert {item["field"] for item in run.report["editorial"]["assessments"]} == set(
        editorial.FIELDS
    )
    assert generate.call_args_list[0].kwargs["max_output_tokens"] == editorial.MAX_OUTPUT_TOKENS
    assert generate.call_args_list[0].args[4]["field_criteria"] == run.inputs["field_criteria"]
    assert generate.call_args_list[0].args[4]["guidance"] == run.inputs["knowledge"]
    assert generate.call_args_list[1].args[3] == grounding.INSTRUCTION
    assert generate.call_args_list[1].kwargs["max_output_tokens"] == grounding.MAX_OUTPUT_TOKENS
    assert run.report["editorial"]["grounding"]["reviewed_items"] == 6
    assert run.inputs["knowledge_version"] == editorial.KNOWLEDGE_VERSION
    assert len(run.inputs["knowledge"]) == 5
    with patch("addons.aso.editorial.knowledge", return_value=[]):
        saved = api.get(f"/api/workspaces/{workspace.pk}/aso/apps/{listing[0].pk}/runs/").data[0]
    assert saved["knowledge"] == run.inputs["knowledge"]
    assert saved["knowledge_version"] == editorial.KNOWLEDGE_VERSION
    assert saved["report"] == run.report
    assert run.workflow.steps.count() == 6
    assert run.report["checks"][-1]["basis"] == "editorial_hypothesis"
    draft = api.post(
        f"/api/workspaces/{workspace.pk}/aso/apps/{listing[0].pk}/drafts/",
        {
            "request_id": str(uuid.uuid4()),
            "name": "Clear subtitle",
            "audit_id": str(run.pk),
            "check_id": run.report["checks"][-1]["id"],
        },
        format="json",
    )
    assert draft.status_code == 201
    assert draft.data["content"]["subtitle"] == "Plan runs & track distance"
    assert draft.data["provenance"][0]["check"]["evidence"]
    assert listing[1].data["subtitle"] == "Your running companion"


def test_missing_models_revoked_keys_and_failure_do_not_fall_back(
    api, workspace, listing, connection
):
    response, _ = start(api, workspace, listing, model="not-a-model")
    assert response.status_code == 400
    response, _ = start(api, workspace, listing)
    run = AuditRun.objects.get(pk=response.data["id"])
    connection.revision = uuid.uuid4()
    connection.save()
    with patch("addons.aso.editorial.generate") as generate:
        audit_listing(str(run.workflow_id))
    generate.assert_not_called()
    run.workflow.refresh_from_db()
    assert run.workflow.status == "failed" and "replaced" in run.workflow.error
    response, _ = start(api, workspace, listing)
    run = AuditRun.objects.get(pk=response.data["id"])
    with patch(
        "addons.aso.editorial.generate",
        side_effect=providers.ProviderError("Provider quota reached."),
    ):
        audit_listing(str(run.workflow_id))
    run.refresh_from_db()
    assert run.workflow.status == "failed" and run.report is None


def test_cancel_discards_ai_output_and_retry_reuses_completed_response(
    api, workspace, listing, connection
):
    response, _ = start(api, workspace, listing)
    run = AuditRun.objects.get(pk=response.data["id"])

    def canceled(*args, **kwargs):
        services.cancel(run.workflow_id)
        return output()

    with patch("addons.aso.editorial.generate", side_effect=canceled):
        audit_listing(str(run.workflow_id))
    run.refresh_from_db()
    assert run.workflow.status == "canceled" and run.report is None
    response, _ = start(api, workspace, listing)
    run = AuditRun.objects.get(pk=response.data["id"])
    with patch("addons.aso.editorial.generate", return_value=output()):
        with patch(
            "addons.aso.editorial.validate",
            side_effect=providers.ProviderError("Validation interrupted."),
        ):
            audit_listing(str(run.workflow_id))
    retry = api.post(
        f"/api/workspaces/{workspace.pk}/aso/runs/{run.pk}/retry/",
        {"request_id": str(uuid.uuid4())},
        format="json",
    )
    next_run = AuditRun.objects.get(pk=retry.data["id"])
    with patch("addons.aso.editorial.generate", side_effect=provider(output())) as generate:
        audit_listing(str(next_run.workflow_id))
    assert generate.call_count == 1  # Saved writing is reused; evidence review remains to run.
    assert generate.call_args.args[3] == grounding.INSTRUCTION
    next_run.refresh_from_db()
    assert next_run.workflow.status == "succeeded"
    assert next_run.report["editorial"]["accepted_proposals"] == 1


def test_validator_rejects_invented_evidence_sources_overflows_and_numeric_claims(listing):
    inputs = {
        "metadata": listing[1].data,
        "locale": "en-US",
        "snapshot_id": str(listing[1].pk),
        "platform": "ios",
        "ruleset": RULESET,
        "ai": {"prompt_version": editorial.VERSION},
        "knowledge": editorial.knowledge(),
    }
    report = audit(inputs)
    for changes in [
        {"source_ids": ["invented-source"]},
        {"replacement": "x" * 31},
        {"observation_quote": "invented observation"},
        {"replacement": "Run 10 times faster"},
        {"evidence": [{"field": "description", "quote": "invented feature"}]},
        {"replacement": "https://evil.example"},
        {"field": "not-a-field"},
    ]:
        invalid = copy.deepcopy(output())
        invalid["result"]["proposals"][0].update(changes)
        result = editorial.validate(invalid, inputs, report)
        assert result["editorial"]["rejected_proposals"] == 1
        assert result["checks"] == report["checks"]
    empty = output()
    empty["result"]["proposals"] = []
    assert editorial.validate(empty, inputs, report)["editorial"]["accepted_proposals"] == 0


def test_editorial_does_not_duplicate_an_existing_proposal(listing):
    inputs = {
        "metadata": listing[1].data,
        "locale": "en-US",
        "snapshot_id": str(listing[1].pk),
        "platform": "ios",
        "ruleset": RULESET,
        "ai": {"prompt_version": editorial.VERSION},
        "knowledge": editorial.knowledge(),
    }
    report = audit(inputs)
    report["checks"].append({"field": "subtitle", "replacement": "Plan runs & track distance"})
    result = editorial.validate(output(), inputs, report)
    assert result["editorial"]["accepted_proposals"] == 0
    assert result["editorial"]["rejected_proposals"] == 1


def review_inputs(listing):
    return {
        "metadata": copy.deepcopy(listing[1].data),
        "locale": "en-US",
        "snapshot_id": str(listing[1].pk),
        "platform": "ios",
        "ruleset": RULESET,
        "ai": {"prompt_version": editorial.VERSION},
        "knowledge": editorial.knowledge(),
    }


def test_evidence_review_failure_and_retry_reuse_the_saved_copy(
    api, workspace, listing, connection
):
    response, _ = start(api, workspace, listing)
    run = AuditRun.objects.get(pk=response.data["id"])
    with patch(
        "addons.aso.editorial.generate",
        side_effect=[output(), providers.ProviderError("Provider quota reached.")],
    ) as generate:
        audit_listing(str(run.workflow_id))
    assert generate.call_count == 2
    run.refresh_from_db()
    assert run.report is None and run.workflow.status == "failed"
    assert run.workflow.steps.get(key="editorial").status == "succeeded"
    retry = api.post(
        f"/api/workspaces/{workspace.pk}/aso/runs/{run.pk}/retry/",
        {"request_id": str(uuid.uuid4())},
        format="json",
    )
    retried = AuditRun.objects.get(pk=retry.data["id"])
    with patch("addons.aso.editorial.generate", side_effect=provider(output())) as generate:
        audit_listing(str(retried.workflow_id))
    assert generate.call_count == 1
    assert generate.call_args.args[3] == grounding.INSTRUCTION
    retried.refresh_from_db()
    assert retried.workflow.status == "succeeded"
    assert retried.report["editorial"]["grounding"]["reviewed_items"] == 6


def test_cancel_during_evidence_review_discards_all_unpublished_copy(
    api, workspace, listing, connection
):
    response, _ = start(api, workspace, listing)
    run = AuditRun.objects.get(pk=response.data["id"])

    def canceled(*args, **kwargs):
        result = provider(output())(*args, **kwargs)
        if args[3] == grounding.INSTRUCTION:
            services.cancel(run.workflow_id)
        return result

    with patch("addons.aso.editorial.generate", side_effect=canceled):
        audit_listing(str(run.workflow_id))
    run.refresh_from_db()
    assert run.workflow.status == "canceled" and run.report is None


@pytest.mark.parametrize(
    "refs",
    [
        ["phiture-aso-stack-2026"],  # A practitioner cannot be the sole authority.
        ["apple-product-page", "apptweak-keyword-research"],  # Wrong field: subtitle.
        ["apple-search"],
        ["apple-product-page", "google-store-listing"],  # Catalog-only, never supplied.
    ],
)
def test_scoped_citations_reject_wrong_field_and_vendor_only_reviews(listing, refs):
    inputs = review_inputs(listing)
    response = output()
    response["result"]["proposals"][0]["source_ids"] = refs
    result = editorial.validate(response, inputs, audit(inputs))
    assert result["editorial"]["rejected_proposals"] == 1
    response["result"]["assessments"]["subtitle"]["source_ids"] = refs
    result = editorial.validate(response, inputs, audit(inputs))
    assert result["editorial"]["reviewed_fields"] == 4
    assert result["editorial"]["assessments"][1]["verdict"] == "unvalidated"


def test_citations_preserve_annotation_and_allow_supplemental_methodology(listing):
    inputs = review_inputs(listing)
    original = copy.deepcopy(inputs)
    response = output()
    refs = ["apple-product-page", "splitmetrics-testing-framework"]
    response["result"]["assessments"]["subtitle"]["source_ids"] = refs
    response["result"]["proposals"][0]["source_ids"] = refs
    result = editorial.validate(response, inputs, audit(inputs))
    assert result["editorial"]["reviewed_fields"] == 5
    assert result["editorial"]["accepted_proposals"] == 1
    citation = result["checks"][-1]["sources"][1]
    annotation = next(item for item in inputs["knowledge"] if item["id"] == refs[1])
    assert citation["guidance"] == annotation["guidance"]
    assert citation["limitations"] == annotation["limitations"]
    assert citation["kind"] == "vendor_methodology"
    assert inputs == original


@pytest.mark.parametrize("remove_scope", [False, True])
def test_current_review_rejects_wrong_store_or_missing_scope(listing, remove_scope):
    inputs = review_inputs(listing)
    for item in inputs["knowledge"]:
        if remove_scope:
            del item["fields"]
        else:
            item["stores"] = ["google_play"]
    result = editorial.validate(output(), inputs, audit(inputs))
    assert result["editorial"]["reviewed_fields"] == 0
    assert result["editorial"]["accepted_proposals"] == 0


@pytest.mark.parametrize(
    "version", ["apple-editorial-2026-10-16.3", "apple-editorial-2026-10-17.1"]
)
def test_older_frozen_guidance_preserves_five_assessments(listing, version):
    inputs = review_inputs(listing)
    inputs["ai"]["prompt_version"] = version
    inputs["knowledge"] = [
        {"id": item["id"], "guidance": "Original saved annotation", "source": item["source"]}
        for item in inputs["knowledge"][:2]
    ]
    with patch("addons.aso.editorial.knowledge", return_value=[]):
        result = editorial.validate(output(), inputs, audit(inputs))
    assert result["editorial"]["reviewed_fields"] == 5
    assert result["editorial"]["accepted_proposals"] == 1
    assert result["checks"][-1]["sources"][0]["guidance"] == "Original saved annotation"


def test_field_coverage_without_forcing_rewrites_and_legacy_reports(listing):
    inputs = review_inputs(listing)
    response = output()
    response["result"]["proposals"] = []
    response["result"]["assessments"]["subtitle"]["verdict"] = "keep"
    original = audit(inputs)
    report = editorial.validate(response, inputs, original)
    assert report["checks"] == original["checks"]
    assert report["editorial"]["accepted_proposals"] == 0
    assert report["editorial"]["reviewed_fields"] == 5
    assert all(item["verdict"] == "keep" for item in report["editorial"]["assessments"])
    assert "editorial" not in original  # Validation never rewrites a saved checkpoint.

    inputs["ai"]["prompt_version"] = "apple-editorial-2026-10-16.2"
    del response["result"]["assessments"]
    legacy = editorial.validate(response, inputs, original)
    assert "assessments" not in legacy["editorial"]


@pytest.mark.parametrize("missing", ["assessments", "name"])
def test_missing_field_coverage_cannot_be_saved_as_a_complete_review(listing, missing):
    inputs = review_inputs(listing)
    response = output()
    if missing == "assessments":
        del response["result"]["assessments"]
    else:
        del response["result"]["assessments"][missing]
    with pytest.raises(providers.ProviderError, match="every field"):
        editorial.validate(response, inputs, audit(inputs))


@pytest.mark.parametrize(
    "changes",
    [
        {"source_ids": ["unknown"]},
        {"evidence": [{"field": "subtitle", "quote": "Invented content"}]},
        {"evidence": [{"field": "description", "quote": "Plan runs and track your distance."}]},
        {"observation": " "},
        {"verdict": "perfect"},
    ],
)
def test_unvalidated_assessment_is_visible_and_blocks_its_proposal(listing, changes):
    inputs = review_inputs(listing)
    response = output()
    response["result"]["assessments"]["subtitle"].update(changes)
    result = editorial.validate(response, inputs, audit(inputs))
    reviews = {item["field"]: item for item in result["editorial"]["assessments"]}
    assert reviews["subtitle"]["verdict"] == "unvalidated"
    assert reviews["subtitle"]["evidence"] == [] and reviews["subtitle"]["sources"] == []
    assert result["editorial"]["reviewed_fields"] == 4
    assert result["editorial"]["accepted_proposals"] == 0
    assert result["editorial"]["rejected_proposals"] == 1


@pytest.mark.parametrize("verdict", ["keep", "insufficient_evidence"])
def test_proposal_cannot_contradict_its_field_assessment(listing, verdict):
    inputs = review_inputs(listing)
    response = output()
    response["result"]["assessments"]["subtitle"]["verdict"] = verdict
    report = editorial.validate(response, inputs, audit(inputs))
    assert report["editorial"]["accepted_proposals"] == 0
    assert report["editorial"]["rejected_proposals"] == 1


def test_unimported_and_empty_fields_are_distinct_and_never_marked_keep(listing):
    inputs = review_inputs(listing)
    inputs["metadata"]["available_fields"] = ["name", "subtitle", "description", "keywords"]
    inputs["metadata"]["subtitle"] = ""
    response = output()
    response["result"]["assessments"]["subtitle"].update(
        observation=(
            "The imported subtitle is empty. Planning and distance tracking "
            "are documented in the description."
        ),
        evidence=[],
    )
    response["result"]["proposals"][0]["observation_quote"] = ""
    report = editorial.validate(response, inputs, audit(inputs))
    reviews = {item["field"]: item for item in report["editorial"]["assessments"]}
    assert reviews["promotional_text"]["verdict"] == "not_imported"
    assert reviews["promotional_text"]["observed"] is None
    assert reviews["promotional_text"]["evidence"] == []
    assert reviews["subtitle"]["observed"] == ""
    assert report["editorial"]["accepted_proposals"] == 1
    assert report["editorial"]["reviewed_fields"] == 4

    response["result"]["assessments"]["subtitle"]["verdict"] = "keep"
    report = editorial.validate(response, inputs, audit(inputs))
    assert report["editorial"]["reviewed_fields"] == 3
    assert report["editorial"]["accepted_proposals"] == 0
