from unittest.mock import patch

import httpx
import pytest

from panda_store.ai import providers
from panda_store.ai.errors import failure, retry_delay


@pytest.mark.parametrize(
    "provider,status,error,headers,code",
    [
        (
            "openai",
            429,
            {"code": "credit_balance_exhausted", "type": "insufficient_quota"},
            {},
            "credits_exhausted",
        ),
        ("openai", 429, {"code": "project_spend_limit_exceeded"}, {}, "spend_limit"),
        ("openai", 429, {"code": "organization_spend_limit_exceeded"}, {}, "spend_limit"),
        ("openai", 429, {"code": "organization_usage_limit_exceeded"}, {}, "quota_exhausted"),
        ("openai", 429, {"type": "insufficient_quota"}, {}, "billing_or_quota"),
        ("openai", 429, {"code": "rate_limit_exceeded"}, {"retry-after": "30"}, "rate_limit"),
        ("google", 402, {"status": "PAYMENT_REQUIRED"}, {}, "billing_required"),
        ("google", 429, {"status": "RESOURCE_EXHAUSTED"}, {}, "rate_or_quota"),
        ("google", 429, {"status": "RESOURCE_EXHAUSTED"}, {"retry-after": "20"}, "rate_limit"),
        ("google", 400, {"details": [{"reason": "API_KEY_INVALID"}]}, {}, "authentication"),
        ("google", 400, {"status": "FAILED_PRECONDITION"}, {}, "account_configuration"),
        (
            "anthropic",
            400,
            {"message": "Your credit balance is too low to access the API."},
            {},
            "credits_exhausted",
        ),
        (
            "anthropic",
            400,
            {"message": "The workspace spend limit was reached."},
            {},
            "spend_limit",
        ),
        ("anthropic", 402, {"type": "billing_error"}, {}, "billing_required"),
        ("anthropic", 429, {"type": "rate_limit_error"}, {}, "rate_or_quota"),
        ("anthropic", 529, {"type": "overloaded_error"}, {}, "provider_unavailable"),
        ("openai", 401, {}, {}, "authentication"),
        ("google", 403, {}, {}, "permission"),
        ("google", 404, {}, {}, "model_unavailable"),
        ("openai", 400, {"code": "context_length_exceeded"}, {}, "input_too_large"),
        ("anthropic", 413, {}, {}, "input_too_large"),
        ("openai", 504, {}, {}, "timeout"),
        ("openai", 503, {}, {}, "provider_unavailable"),
        ("google", 400, {}, {}, "invalid_request"),
    ],
)
def test_provider_failures_are_actionable_private_and_never_retried(
    provider, status, error, headers, code
):
    secret = "test-secret-must-not-reach-user"
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(status, json={"error": {**error, "private": secret}}, headers=headers)

    real_client = httpx.AsyncClient
    with patch(
        "panda_store.ai.providers.httpx.AsyncClient",
        side_effect=lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw),
    ):
        with pytest.raises(providers.ProviderError) as caught:
            providers.request(provider, secret, "/models")
    assert caught.value.code == code
    assert secret not in str(caught.value)
    assert len(str(caught.value)) <= 300
    assert len(calls) == 1
    if headers:
        assert headers["retry-after"] in str(caught.value)


@pytest.mark.parametrize(
    "kind,code", [(httpx.ReadTimeout, "timeout"), (httpx.ConnectError, "network")]
)
def test_network_errors_do_not_expose_transport_details(kind, code):
    with patch("panda_store.ai.providers.httpx.AsyncClient", side_effect=kind("sensitive details")):
        with pytest.raises(providers.ProviderError) as caught:
            providers.request("google", "test", "/models")
    assert caught.value.code == code
    assert "sensitive" not in str(caught.value)


def test_unknown_429_is_not_presented_as_exhausted_credits_and_retry_header_is_untrusted():
    assert failure("google", 429, {"error": "private"}).code == "rate_or_quota"
    assert retry_delay("https://private.example/?key=secret") is None
    assert retry_delay("nan") is None
    assert retry_delay("999999999999999999999") is None
    assert retry_delay("2.5") == 3


@pytest.mark.parametrize(
    "provider,model,response,code",
    [
        (
            "google",
            "gemini-3.8-flash",
            {"promptFeedback": {"blockReason": "SAFETY"}},
            "content_blocked",
        ),
        (
            "google",
            "gemini-3.8-flash",
            {"candidates": [{"finishReason": "RECITATION"}]},
            "content_blocked",
        ),
        (
            "anthropic",
            "claude-sonnet-4-5",
            {"content": [], "stop_reason": "max_tokens"},
            "output_limit",
        ),
        (
            "anthropic",
            "claude-sonnet-4-5",
            {"content": [], "stop_reason": "refusal"},
            "content_blocked",
        ),
        (
            "openai",
            "gpt-4.1-mini",
            {"status": "incomplete", "incomplete_details": {"reason": "max_output_tokens"}},
            "output_limit",
        ),
        (
            "openai",
            "gpt-4.1-mini",
            {
                "status": "completed",
                "output": [
                    {"type": "message", "content": [{"type": "refusal", "refusal": "private"}]}
                ],
            },
            "content_blocked",
        ),
    ],
)
def test_blocked_or_truncated_outputs_are_not_saved_as_recommendations(
    provider, model, response, code
):
    with patch("panda_store.ai.providers.request", return_value=response):
        with pytest.raises(providers.ProviderError) as caught:
            providers.generate(provider, "test", model, "instruction", {}, {})
    assert caught.value.code == code
    assert "private" not in str(caught.value)
