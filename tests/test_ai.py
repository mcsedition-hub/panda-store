import copy
import uuid
from unittest.mock import patch

import httpx
import pytest
from rest_framework.test import APIClient

from addons.app_catalog.models import MetadataSnapshot, MobileApp
from addons.aso import editorial
from addons.aso.models import AuditRun
from addons.aso.rules import RULESET, audit
from addons.aso.tasks import audit_listing
from panda_store.ai import providers
from panda_store.core.access import activate_modules
from panda_store.core.credentials import decrypt, encrypt
from panda_store.core.models import AIConnection, Membership, Workspace
from panda_store.workflows import services

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
            ]
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
    assert call.call_args.kwargs["params"]["pageToken"] == "next"
    assert not providers.supported("openai", "gpt-4o-audio-preview")
    assert not providers.supported("google", "../../secrets")


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
            provider, KEY, model, "instruction", {"listing": "data"}, editorial.SCHEMA
        )
    assert result["result"] == {"proposals": []} and result["usage"]["input_tokens"] == 20
    payload = call.call_args.kwargs["payload"]
    if provider == "openai":
        assert payload["store"] is False and payload["text"]["format"]["strict"]
    elif provider == "anthropic":
        assert payload["tool_choice"]["name"] == "listing_review"
    else:
        assert payload["generationConfig"]["responseMimeType"] == "application/json"


def test_editorial_audit_freezes_choice_records_usage_and_creates_draft(
    api, workspace, listing, connection
):
    response, data = start(api, workspace, listing)
    assert response.status_code == 202
    run = AuditRun.objects.get(pk=response.data["id"])
    assert run.inputs["ai"]["model"] == "gpt-4.1-mini"
    assert KEY not in str(run.inputs)
    with patch("addons.aso.editorial.generate", return_value=output()) as generate:
        audit_listing(str(run.workflow_id))
        audit_listing(str(run.workflow_id))
    assert generate.call_count == 1
    run.refresh_from_db()
    assert run.workflow.status == "succeeded"
    assert run.report["editorial"]["accepted_proposals"] == 1
    assert run.report["editorial"]["usage"]["output_tokens"] == 150
    assert run.workflow.steps.count() == 5
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

    def canceled(*args):
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
    with patch("addons.aso.editorial.generate") as generate:
        audit_listing(str(next_run.workflow_id))
    generate.assert_not_called()
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
