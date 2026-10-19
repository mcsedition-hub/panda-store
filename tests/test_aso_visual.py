import asyncio
import copy
import io
import json
import uuid
from unittest.mock import patch

import httpx
import pytest
from PIL import Image
from rest_framework.test import APIClient

from addons.aso import images, visual
from addons.aso.models import AuditRun, ScreenshotEvidence
from addons.aso.tasks import audit_listing
from panda_store.ai import providers
from panda_store.core.access import deactivate_module
from panda_store.core.credentials import encrypt
from panda_store.core.models import AIConnection, Membership, Workspace
from panda_store.workflows import services
from tests.test_ai import connection as ai_connection
from tests.test_ai import listing as text_listing
from tests.test_ai import start

connection = ai_connection
listing = text_listing


def png():
    stream = io.BytesIO()
    Image.new("RGB", (400, 800), "white").save(stream, format="PNG")
    return stream.getvalue()


@pytest.fixture
def visual_listing(listing):
    app, snapshot = listing
    snapshot.data.update(
        screenshots_locale="en-US",
        screenshots=[
            {
                "name": "run.png",
                "display_type": "APP_IPHONE_65",
                "url": "https://is1-ssl.mzstatic.com/image.png",
            },
            {
                "name": "detail.png",
                "display_type": "APP_IPHONE_65",
                "url": "https://is2-ssl.mzstatic.com/image.png",
            },
        ],
    )
    snapshot.save()
    return app, snapshot


def responder(*args, **kwargs):
    """Protocol fixture, not a test of visual reasoning quality."""
    ctx = args[4]
    assert len(kwargs["images"]) == len(ctx["images"])
    if args[3] == visual.REVIEW_INSTRUCTION:
        result = {
            "reviews": [
                {
                    "image_id": item["image_id"],
                    "verdict": "supported" if i == 0 else "unsupported",
                    "reason": "Synthetic verdict.",
                }
                for i, item in enumerate(ctx["candidates"])
            ]
        }
    else:
        result = {
            "assessments": [
                {
                    "image_id": item["image_id"],
                    "verdict": "keep",
                    "observation": "Synthetic observation.",
                    "visible_text": "",
                    "recommendation": "",
                    "source_ids": ["apple-screenshot-practices"],
                }
                for item in ctx["images"]
            ]
        }
    return {
        "result": result,
        "provider": "openai",
        "model": "gpt-4.1-mini",
        "resolved_model": "gpt-4.1-mini",
        "usage": {"input_tokens": 10, "output_tokens": 20},
    }


def launch(api, workspace, visual_listing):
    response, payload = start(api, workspace, visual_listing, mode="screenshots")
    assert response.status_code == 202, response.data
    return AuditRun.objects.get(pk=response.data["id"]), payload


def test_visual_review_freezes_images_and_withholds_unsupported_items(
    api, workspace, visual_listing, connection, owner
):
    run, payload = launch(api, workspace, visual_listing)
    with (
        patch("addons.aso.images.download_batch", return_value=[(png(), ""), (png(), "")]),
        patch("addons.aso.editorial.generate", side_effect=responder) as generate,
    ):
        audit_listing(str(run.workflow_id))
    run.refresh_from_db()
    assert run.workflow.status == "succeeded", run.workflow.error
    result = run.report["visual"]
    assert result["reviewed_images"] == 2 and result["withheld"] == 1
    assert result["images"][0]["status"] == "reviewed"
    assert result["images"][1]["status"] == "withheld"
    assert "observation" not in result["images"][1]
    assert generate.call_count == 2
    assert (
        generate.call_args_list[0].kwargs["images"] == generate.call_args_list[1].kwargs["images"]
    )
    assert ScreenshotEvidence.objects.count() == 2
    path = result["images"][0]["url"]
    image = api.get(path)
    assert image.status_code == 200 and image["Content-Type"] == "image/jpeg"
    assert image["Cache-Control"] == "private, no-store"
    original = image.content
    visual_listing[1].data["screenshots"] = []
    visual_listing[1].save()
    assert api.get(path).content == original
    assert APIClient().get(path).status_code in {401, 403}
    other = Workspace.objects.create(name="Other")
    Membership.objects.create(workspace=other, user=owner, role="owner")
    from panda_store.core.access import activate_modules

    activate_modules(other, ["aso"])
    assert api.get(path.replace(str(workspace.pk), str(other.pk))).status_code == 404
    deactivate_module(workspace, "aso")
    assert api.get(path).status_code == 403


def test_visual_review_requires_model_exact_locale_and_saved_sources(
    api, workspace, visual_listing, connection
):
    response, _ = start(
        api, workspace, visual_listing, mode="screenshots", provider=None, model=None
    )
    assert response.status_code == 400
    _, snapshot = visual_listing
    snapshot.data["screenshots_locale"] = "fr-FR"
    snapshot.save()
    response, _ = start(api, workspace, visual_listing, mode="screenshots")
    assert response.status_code == 400
    snapshot.data["screenshots_locale"] = "en-US"
    snapshot.save()
    run, payload = launch(api, workspace, visual_listing)
    examples = [
        note
        for note in run.inputs["knowledge"]
        if note["source"]["kind"] == "public_listing_observation"
    ]
    assert (
        len(examples) == 3
        and len({note["observation_context"]["domain"] for note in examples}) == 3
    )
    assert all(note["fields"] == ["screenshots"] for note in run.inputs["knowledge"])
    assert "google-preview-assets" not in {note["id"] for note in run.inputs["knowledge"]}
    url = f"/api/workspaces/{workspace.pk}/aso/apps/{run.app_id}/runs/"
    assert api.post(url, payload, format="json").status_code == 200
    assert api.post(url, {**payload, "mode": "listing"}, format="json").status_code == 409


@pytest.mark.parametrize("change_model", [False, True])
def test_visual_retry_reuses_archived_images_and_first_call(
    api, workspace, visual_listing, connection, change_model
):
    run, _ = launch(api, workspace, visual_listing)

    def fail_verification(*args, **kwargs):
        if args[3] == visual.REVIEW_INSTRUCTION:
            raise providers.ProviderError("Quota exhausted.", code="quota")
        return responder(*args, **kwargs)

    with (
        patch("addons.aso.images.download_batch", return_value=[(png(), ""), (png(), "")]),
        patch("addons.aso.editorial.generate", side_effect=fail_verification),
    ):
        audit_listing(str(run.workflow_id))
    run.refresh_from_db()
    assert run.workflow.status == "failed" and run.report is None
    choice = {}
    if change_model:
        connection.model_catalog.append({"id": "gpt-4.1"})
        connection.save()
        choice = {"provider": "openai", "model": "gpt-4.1"}
    response = api.post(
        f"/api/workspaces/{workspace.pk}/aso/runs/{run.pk}/retry/",
        {"request_id": str(uuid.uuid4()), **choice},
        format="json",
    )
    assert response.status_code == 202, response.data
    retry = AuditRun.objects.get(pk=response.data["id"])
    with (
        patch("addons.aso.images.download_batch") as fetch,
        patch("addons.aso.editorial.generate", side_effect=responder) as generate,
    ):
        audit_listing(str(retry.workflow_id))
    retry.refresh_from_db()
    assert retry.workflow.status == "succeeded", retry.workflow.error
    fetch.assert_not_called()
    assert generate.call_count == (2 if change_model else 1)
    assert all(
        call.args[2] == choice.get("model", "gpt-4.1-mini") for call in generate.call_args_list
    )
    assert ScreenshotEvidence.objects.count() == 2
    assert api.get(retry.report["visual"]["images"][0]["url"]).status_code == 200


def test_visual_retry_rejects_a_connected_text_only_model(
    api, workspace, visual_listing, connection
):
    run, _ = launch(api, workspace, visual_listing)
    services.fail(run.workflow_id, "Test interruption")
    AIConnection.objects.create(
        workspace=workspace,
        provider="zai",
        encrypted_key=encrypt("test-zai"),
        model_catalog=[{"id": "glm-4.7-flash"}],
    )
    response = api.post(
        f"/api/workspaces/{workspace.pk}/aso/runs/{run.pk}/retry/",
        {"request_id": str(uuid.uuid4()), "provider": "zai", "model": "glm-4.7-flash"},
        format="json",
    )
    assert response.status_code == 400
    assert AuditRun.objects.count() == 1


def test_missing_images_are_explicit_and_all_unavailable_never_calls_ai(
    api, workspace, visual_listing, connection
):
    for available in (True, False):
        run, _ = launch(api, workspace, visual_listing)
        downloaded = [(png(), "") if available else (None, "Unavailable"), (None, "Unavailable")]
        with (
            patch("addons.aso.images.download_batch", return_value=downloaded),
            patch("addons.aso.editorial.generate", side_effect=responder) as generate,
        ):
            audit_listing(str(run.workflow_id))
        run.refresh_from_db()
        if available:
            assert run.report["visual"]["images"][1]["status"] == "unavailable"
            assert run.report["visual"]["reviewed_images"] == 1
        else:
            assert run.workflow.status == "failed" and run.report is None
            generate.assert_not_called()


def test_incomplete_or_stale_evidence_reviews_cannot_be_published(
    api, workspace, visual_listing, connection
):
    run, _ = launch(api, workspace, visual_listing)
    with (
        patch("addons.aso.images.download_batch", return_value=[(png(), ""), (png(), "")]),
        patch("addons.aso.editorial.generate", side_effect=responder),
    ):
        audit_listing(str(run.workflow_id))
    steps = {step.key: step.output for step in run.workflow.steps.all()}
    for invalid in (
        {**steps["verify_visual"], "context_sha256": "stale"},
        {**steps["verify_visual"], "result": {"reviews": []}},
    ):
        with pytest.raises(providers.ProviderError):
            visual.report(run, steps["images"], steps["visual"], invalid)
    output = copy.deepcopy(steps["visual"])
    output["result"]["assessments"][0]["source_ids"] = ["duolingo-us-iphone-2026-10-17"]
    with pytest.raises(providers.ProviderError):
        visual.candidates(run, steps["images"], output)


@pytest.mark.parametrize(
    "url",
    [
        "http://is1-ssl.mzstatic.com/a",
        "https://localhost/a",
        "https://127.0.0.1/a",
        "https://is1-ssl.mzstatic.com.evil.test/a",
        "https://user@is1-ssl.mzstatic.com/a",
        "https://is1-ssl.mzstatic.com:9000/a",
        "file:///tmp/a",
        "https://[bad/a",
    ],
)
def test_arbitrary_urls_never_reach_network(url):
    with patch("addons.aso.images.httpx.AsyncClient") as client:
        with pytest.raises(ValueError):
            asyncio.run(images.download(url))
        client.assert_not_called()


def test_image_downloader_rejects_redirects_and_oversized_responses():
    real = httpx.AsyncClient
    for response in [
        httpx.Response(302, headers={"Location": "http://127.0.0.1"}),
        httpx.Response(200, content=b"x" * 101),
    ]:
        client = real(transport=httpx.MockTransport(lambda _request, response=response: response))
        with (
            patch("addons.aso.images.httpx.AsyncClient", return_value=client),
            patch("addons.aso.images.MAX_DOWNLOAD", 100),
        ):
            with pytest.raises(ValueError):
                asyncio.run(images.download("https://is1-ssl.mzstatic.com/a"))


def test_image_decoder_limits_and_strips_metadata():
    data, info = images.normalize(png())
    assert data.startswith(b"\xff\xd8")
    assert info["width"] == 400 and info["height"] == 800 and len(info["sha256"]) == 64
    with pytest.raises(ValueError):
        images.normalize(b"<svg><script>bad</script></svg>")
    with patch("addons.aso.images.MAX_STORED", 1), pytest.raises(ValueError):
        images.normalize(png())


def test_download_batch_has_a_total_deadline_and_retains_coverage():
    timeout = asyncio.timeout

    async def slow(_url):
        await asyncio.sleep(0.05)
        return png()

    with (
        patch("addons.aso.images.download", side_effect=slow),
        patch("addons.aso.images.asyncio.timeout", side_effect=lambda _limit: timeout(0.01)),
    ):
        results = asyncio.run(images.download_batch([{"url": "one"}, {"url": "two"}]))
    assert len(results) == 2 and all(data is None and error for data, error in results)


def test_visual_capture_limits_input_count_without_hiding_remaining_images(
    api, workspace, visual_listing, connection
):
    app, snapshot = visual_listing
    snapshot.data["screenshots"] *= 6
    snapshot.save()
    run, _ = launch(api, workspace, visual_listing)
    with (
        patch("addons.aso.images.download_batch", return_value=[(png(), "")] * 10) as fetch,
        patch("addons.aso.editorial.generate", side_effect=responder),
    ):
        audit_listing(str(run.workflow_id))
    run.refresh_from_db()
    assert run.workflow.status == "succeeded", run.workflow.error
    assert len(fetch.call_args.args[0]) == 10
    assert len(run.report["visual"]["images"]) == 10
    assert run.report["visual"]["total_imported"] == 12


def test_cancellation_after_capture_stops_before_paid_call(
    api, workspace, visual_listing, connection
):
    from panda_store.workflows import services

    run, _ = launch(api, workspace, visual_listing)

    normalize = images.normalize

    def canceled(data):
        services.cancel(run.workflow_id)
        return normalize(data)

    with (
        patch("addons.aso.images.download_batch", return_value=[(png(), ""), (png(), "")]),
        patch("addons.aso.images.normalize", side_effect=canceled),
        patch("addons.aso.editorial.generate") as generate,
    ):
        audit_listing(str(run.workflow_id))
    run.refresh_from_db()
    assert run.workflow.status == "canceled" and run.report is None
    generate.assert_not_called()


@pytest.mark.parametrize(
    "provider,model",
    [("openai", "gpt-4.1-mini"), ("google", "gemini-2.5-pro"), ("anthropic", "claude-sonnet-4-5")],
)
def test_image_adapters_send_labeled_inline_bytes(provider, model):
    response = {
        "status": "completed",
        "output": [{"type": "message", "content": [{"type": "output_text", "text": "{}"}]}],
        "candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": "{}"}]}}],
        "stop_reason": "tool_use",
        "content": [{"type": "tool_use", "name": "listing_review", "input": {}}],
    }
    with patch("panda_store.ai.providers.request", return_value=response) as request:
        providers.generate(
            provider,
            "test",
            model,
            "test",
            {},
            {},
            images=[{"id": "shot-1", "mime_type": "image/jpeg", "data": "QUJD"}],
        )
    payload = request.call_args.kwargs["payload"]
    assert "shot-1" in json.dumps(payload)
    if provider == "openai":
        assert payload["input"][0]["content"][2]["image_url"] == "data:image/jpeg;base64,QUJD"
    elif provider == "google":
        assert payload["contents"][0]["parts"][2]["inlineData"] == {
            "mimeType": "image/jpeg",
            "data": "QUJD",
        }
    else:
        assert payload["messages"][0]["content"][2]["source"] == {
            "type": "base64",
            "media_type": "image/jpeg",
            "data": "QUJD",
        }
