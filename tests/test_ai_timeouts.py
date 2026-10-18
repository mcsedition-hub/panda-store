import asyncio
from unittest.mock import patch

import httpx
import pytest

from addons.aso.tasks import audit_listing
from panda_store.ai import providers


@pytest.mark.parametrize("provider", ["google", "openai", "anthropic", "zai"])
def test_generation_has_its_own_configurable_budget_without_slowing_catalogs(settings, provider):
    settings.PANDA_AI_TIMEOUT_SECONDS = 420
    timeouts = []

    async def handler(request):
        timeouts.append(request.extensions["timeout"])
        return httpx.Response(200, json={"ok": True})

    real_client = httpx.AsyncClient
    real_deadline = asyncio.timeout
    with (
        patch(
            "panda_store.ai.providers.httpx.AsyncClient",
            side_effect=lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw),
        ),
        patch("panda_store.ai.providers.asyncio.timeout", wraps=real_deadline) as deadline,
    ):
        assert providers.request(provider, "test", "/generate", payload={}) == {"ok": True}
        assert providers.request(provider, "test", "/models") == {"ok": True}
    assert [item.args[0] for item in deadline.call_args_list] == [420, 90]
    assert [item["read"] for item in timeouts] == [420, 70]
    assert all(item["connect"] == 10 for item in timeouts)


@pytest.mark.parametrize("delay", ["headers", "body", "trickle"])
def test_whole_request_deadline_cancels_network_io_and_closes_without_retry(settings, delay):
    # Shorten time only for this test; no real provider or long wall-clock sleep.
    settings.PANDA_AI_TIMEOUT_SECONDS = 0.03
    calls = 0
    closed = False

    class Body(httpx.AsyncByteStream):
        async def __aiter__(self):
            if delay == "body":
                await asyncio.sleep(10)
            while True:
                yield b" "
                await asyncio.sleep(0.001)

        async def aclose(self):
            nonlocal closed
            closed = True

    async def handler(request):
        nonlocal calls
        calls += 1
        if delay == "headers":
            await asyncio.sleep(10)
        return httpx.Response(200, stream=Body())

    real_client = httpx.AsyncClient
    with patch(
        "panda_store.ai.providers.httpx.AsyncClient",
        side_effect=lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw),
    ):
        with pytest.raises(providers.ProviderError) as caught:
            providers.request("google", "secret-must-not-leak", "/generate", payload={})
    assert caught.value.code == "timeout"
    assert "Google Gemini" in str(caught.value)
    assert "0.03s" in str(caught.value)
    assert "secret-must-not-leak" not in str(caught.value)
    assert calls == 1
    if delay != "headers":
        assert closed


def test_celery_allows_both_generation_deadlines_and_checkpoint_overhead(settings):
    assert audit_listing.soft_time_limit >= 2 * settings.PANDA_AI_TIMEOUT_SECONDS + 60
    assert audit_listing.time_limit > audit_listing.soft_time_limit
