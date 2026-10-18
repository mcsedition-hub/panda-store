import json
import uuid
from unittest.mock import patch

import pytest

from addons.aso import grounding
from addons.aso.models import AuditRun
from addons.aso.tasks import audit_listing
from addons.studio.models import SocialResearch
from addons.studio.research_search import search
from panda_store.ai import providers, zai
from panda_store.ai.errors import failure
from panda_store.core.access import activate_modules
from panda_store.core.credentials import decrypt, encrypt
from panda_store.core.models import AIConnection
from tests.aso_support import supported_review
from tests.test_ai import listing as ai_listing
from tests.test_ai import output

listing = ai_listing
KEY = "test-zai-key-not-real-12345"
SCHEMA = {
    "type": "object",
    "properties": {"accepted": {"type": "boolean"}},
    "required": ["accepted"],
    "additionalProperties": False,
}


def response(content='{"accepted":true}', reason="stop", model="glm-4.7-flash"):
    return {
        "model": model,
        "choices": [{"finish_reason": reason, "message": {"content": content}}],
        "usage": {"prompt_tokens": 120, "completion_tokens": 45},
    }


def connection(workspace):
    return AIConnection.objects.create(
        workspace=workspace,
        provider="zai",
        encrypted_key=encrypt(KEY),
        model_catalog=[{"id": model, "name": model, **meta} for model, meta in zai.MODELS.items()],
    )


def test_connection_checks_only_free_model_and_keeps_encrypted_key(api, workspace):
    url = f"/api/workspaces/{workspace.pk}/ai/zai/"
    with patch("panda_store.ai.providers.request", return_value=response("OK")) as call:
        result = api.put(url, {"api_key": KEY}, format="json")
    assert result.status_code == 200
    assert KEY.encode() not in result.content
    saved = AIConnection.objects.get(provider="zai", workspace=workspace)
    assert saved.encrypted_key != KEY and decrypt(saved.encrypted_key) == KEY
    assert call.call_count == 1
    assert call.call_args.args == ("zai", KEY, "/chat/completions")
    payload = call.call_args.kwargs["payload"]
    assert payload["model"] == "glm-4.7-flash"
    assert payload["max_tokens"] == 16
    assert payload["messages"] == [{"role": "user", "content": "Reply with OK."}]
    catalog = {item["id"]: item for item in saved.model_catalog}
    assert catalog["glm-4.6v-flash"]["vision"] is True
    assert catalog["glm-4.6v-flash"]["listed_free"] is True
    assert catalog["glm-5.3"]["listed_free"] is False

    revision = str(saved.revision)
    with patch("panda_store.ai.providers.request", return_value=response("OK")) as call:
        assert api.post(url, {"revision": revision}, format="json").status_code == 200
    assert call.call_args.args[1] == KEY
    saved.refresh_from_db()
    assert str(saved.revision) == revision


def test_rejected_zai_key_is_not_saved_or_echoed(api, workspace):
    with patch(
        "panda_store.ai.providers.request",
        side_effect=failure("zai", 401, {"error": {"code": "1000", "message": KEY}}),
    ):
        result = api.put(f"/api/workspaces/{workspace.pk}/ai/zai/", {"api_key": KEY}, format="json")
    assert result.status_code == 400 and KEY not in str(result.data)
    assert not AIConnection.objects.filter(provider="zai").exists()


@pytest.mark.parametrize("model", ["glm-4.7-flash", "glm-4.6v-flash", "glm-5.3"])
def test_zai_protocol_validates_schema_and_preserves_usage(model):
    images = [{"id": "frame-1", "mime_type": "image/jpeg", "data": "QUJD"}] if "v-" in model else []
    with patch("panda_store.ai.providers.request", return_value=response(model=model)) as call:
        result = providers.generate(
            "zai",
            KEY,
            model,
            "Review evidence.",
            {"app": "Test"},
            SCHEMA,
            images=images,
            response_language="fr",
        )
    payload = call.call_args.kwargs["payload"]
    assert payload["stream"] is False and payload["model"] == model
    assert json.dumps(SCHEMA) in payload["messages"][0]["content"]
    assert "Response language: French (fr)." in payload["messages"][0]["content"]
    assert "tools" not in payload
    if images:
        assert "response_format" not in payload
        assert payload["messages"][1]["content"][1]["text"] == "Screenshot ID: frame-1"
        assert (
            payload["messages"][1]["content"][2]["image_url"]["url"]
            == "data:image/jpeg;base64,QUJD"
        )
    else:
        assert payload["response_format"] == {"type": "json_object"}
    assert payload["thinking"]["type"] == ("enabled" if model == "glm-5.3" else "disabled")
    assert result["result"] == {"accepted": True}
    assert result["provider"] == "zai" and result["resolved_model"] == model
    assert result["usage"] == {"input_tokens": 120, "output_tokens": 45}


@pytest.mark.parametrize(
    "content",
    [
        "{}",
        '{"accepted":"yes"}',
        '{"accepted":true,"extra":1}',
        "[]",
        'Here is the result: {"accepted":true}',
        '```json\n{"accepted":true}\n``` extra',
    ],
)
def test_zai_rejects_incorrect_structures_without_another_call(content):
    with patch("panda_store.ai.providers.request", return_value=response(content)) as call:
        with pytest.raises(providers.ProviderError) as error:
            providers.generate("zai", KEY, "glm-4.7-flash", "test", {}, SCHEMA)
    assert error.value.code == "invalid_output" and call.call_count == 1


def test_zai_accepts_a_single_fenced_json_object():
    with patch(
        "panda_store.ai.providers.request", return_value=response('```json\n{"accepted":true}\n```')
    ):
        assert providers.generate("zai", KEY, "glm-4.6v-flash", "test", {}, SCHEMA)["result"] == {
            "accepted": True
        }


@pytest.mark.parametrize(
    "reason,code",
    [
        ("length", "output_limit"),
        ("sensitive", "content_blocked"),
        ("model_context_window_exceeded", "output_limit"),
        ("network_error", "provider_error"),
        ("tool_calls", "provider_error"),
    ],
)
def test_zai_never_saves_incomplete_or_refused_output(reason, code):
    with patch("panda_store.ai.providers.request", return_value=response(reason=reason)) as call:
        with pytest.raises(providers.ProviderError) as error:
            providers.generate("zai", KEY, "glm-4.7-flash", "test", {}, SCHEMA)
    assert error.value.code == code and call.call_count == 1


@pytest.mark.parametrize(
    "code,expected",
    [
        (1113, "credits_exhausted"),
        (1302, "rate_limit"),
        (1305, "provider_unavailable"),
        (1308, "quota_exhausted"),
        (1315, "authentication"),
        (1211, "model_unavailable"),
        (1301, "content_blocked"),
        (1261, "input_too_large"),
    ],
)
def test_zai_business_errors_are_actionable_and_do_not_echo_raw_values(code, expected):
    for value in (code, str(code)):
        error = failure("zai", 429, {"error": {"code": value, "message": KEY}})
        assert error.code == expected and KEY not in str(error)


def test_zai_blocks_unsupported_capabilities_before_any_request():
    with patch("panda_store.ai.providers.request") as call:
        with pytest.raises(providers.ProviderError, match="only accepts text"):
            providers.generate("zai", KEY, "glm-4.7-flash", "test", {}, SCHEMA, images=[{}])
        with pytest.raises(providers.ProviderError, match="Legacy web discovery"):
            search("zai", KEY, "glm-4.6v-flash", {})
        with pytest.raises(providers.ProviderError, match="supported"):
            providers.generate("zai", KEY, "glm-image", "test", {}, SCHEMA)
    call.assert_not_called()


def test_zai_aso_audit_runs_writing_and_grounding_with_same_connection(api, workspace, listing):
    app, snapshot = listing
    connection(workspace)
    result = api.post(
        f"/api/workspaces/{workspace.pk}/aso/apps/{app.pk}/runs/",
        {
            "request_id": str(uuid.uuid4()),
            "snapshot_id": str(snapshot.pk),
            "locale": "en-US",
            "provider": "zai",
            "model": "glm-4.7-flash",
        },
        format="json",
    )
    assert result.status_code == 202, result.data

    def answer(provider, key, path, *, payload):
        assert provider == "zai" and key == KEY
        context = json.loads(payload["messages"][1]["content"])
        review = payload["messages"][0]["content"].startswith(grounding.INSTRUCTION)
        result = supported_review(context)["result"] if review else output()["result"]
        return response(json.dumps(result))

    with patch("panda_store.ai.providers.request", side_effect=answer) as call:
        audit_listing(result.data["workflow_id"])
    run = AuditRun.objects.get(pk=result.data["id"])
    assert run.workflow.status == "succeeded", run.workflow.error
    assert call.call_count == 2
    assert run.report["editorial"]["provider"] == "zai"


def test_zai_text_model_cannot_start_screenshot_or_social_analysis(api, workspace, imported):
    from addons.app_catalog.models import MobileApp

    activate_modules(workspace, ["aso"])
    app = MobileApp.objects.get(pk=imported["id"])
    snapshot = app.snapshots.first()
    snapshot.data.update(
        screenshots_locale="en-US", screenshots=[{"url": "https://example.com/test.png"}]
    )
    snapshot.save()
    connection(workspace)
    common = {
        "request_id": str(uuid.uuid4()),
        "snapshot_id": str(snapshot.pk),
        "provider": "zai",
        "model": "glm-4.7-flash",
    }
    result = api.post(
        f"/api/workspaces/{workspace.pk}/aso/apps/{app.pk}/runs/",
        {**common, "mode": "screenshots", "locale": "en-US"},
        format="json",
    )
    assert result.status_code == 400 and "vision" in str(result.data)
    assert not AuditRun.objects.exists()
    social = {
        **common,
        "topic": "Running apps for beginners",
        "market": "en-US",
        "platforms": ["tiktok"],
        "min_views": 10000,
        "min_likes": 500,
        "facts_confirmed": True,
        "brief": {
            "audience": "New runners",
            "goal": "Try the app",
            "tone": "Clear",
            "product_facts": "The app helps plan a run.",
            "language": "English",
            "duration_seconds": 30,
        },
    }
    url = f"/api/workspaces/{workspace.pk}/studio/apps/{app.pk}/social-research/"
    result = api.post(url, social, format="json")
    assert result.status_code == 400 and "vision" in str(result.data)
    assert not SocialResearch.objects.exists()
    social["model"] = "glm-4.6v-flash"
    assert api.post(url, social, format="json").status_code == 202


def test_zai_legacy_research_fails_before_browser_launch(api, workspace, imported):
    from addons.app_catalog.models import MobileApp

    app = MobileApp.objects.get(pk=imported["id"])
    connection(workspace)
    with patch("addons.studio.research_views.browser_ready") as browser:
        result = api.post(
            f"/api/workspaces/{workspace.pk}/studio/apps/{app.pk}/research/",
            {
                "request_id": str(uuid.uuid4()),
                "snapshot_id": str(app.snapshots.first().pk),
                "topic": "Running apps",
                "market": "en-US",
                "provider": "zai",
                "model": "glm-4.6v-flash",
            },
            format="json",
        )
    assert result.status_code == 400 and "browser research" in str(result.data)
    browser.assert_not_called()
