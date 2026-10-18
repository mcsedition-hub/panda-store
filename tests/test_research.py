import base64
import copy
import socket
import uuid
from types import SimpleNamespace
from unittest.mock import patch

import httpcore
import pytest
from rest_framework.test import APIClient

from addons.app_catalog.models import MobileApp
from addons.studio import research_analysis as analysis
from addons.studio import research_search as discovery
from addons.studio import research_tasks as tasks
from addons.studio.models import ResearchRun
from addons.studio.research_network import AccessBlocked, PublicNetwork, address
from panda_store.ai.providers import ProviderError
from panda_store.core.credentials import encrypt
from panda_store.core.models import AIConnection, Membership, Workspace
from panda_store.workflows import services


@pytest.fixture
def setup(api, workspace, imported):
    app = MobileApp.objects.get(pk=imported["id"])
    AIConnection.objects.create(
        workspace=workspace,
        provider="openai",
        encrypted_key=encrypt("fake-research-key"),
        model_catalog=[{"id": "gpt-4.1-mini"}],
    )
    url = f"/api/workspaces/{workspace.pk}/studio/"
    data = {
        "request_id": str(uuid.uuid4()),
        "snapshot_id": str(app.snapshots.first().pk),
        "topic": "Running apps for beginners",
        "market": "en-US",
        "provider": "openai",
        "model": "gpt-4.1-mini",
    }
    with patch("addons.studio.research_views.browser_ready", return_value=True):
        response = api.post(f"{url}apps/{app.pk}/research/", data, format="json")
    assert response.status_code == 202, response.data
    return url, app, data, ResearchRun.objects.get(pk=response.data["id"])


def evidence():
    return {
        "status": "observed",
        "reason": "Two positions. No video.",
        "text": "Plan a short run. Start with ten minutes. 120 views.",
        "title": "Running example",
        "final_url": "https://public.example/post",
        "trace": [{"action": "scroll", "y": 700}],
        "images": {"top": base64.b64encode(b"test-jpeg").decode()},
        "hashes": {"top": "fixed-hash"},
    }


def finding(page_id="page-one"):
    return {
        "page_id": page_id,
        "content_type": "unknown",
        "observation": "The opening describes a short run.",
        "hook_quote": "Plan a short run.",
        "structure": "An opening followed by a first step.",
        "idea_to_test": "Test an opening focused on one small action.",
        "evidence_quotes": ["Plan a short run."],
        "metrics": [{"label": "Views", "quote": "120 views"}],
    }


def search_result():
    return {
        "sources": [
            {
                "url": "https://public.example/post",
                "title": "Example",
                "kind": "discovered",
                "domain": "",
            }
        ],
        "queries": ["beginner running apps"],
        "warnings": [],
        "search_widget": "",
        "usage": {},
        "model": "gpt-4.1-mini",
    }


def mock_analysis(run, pages, findings=None):
    if findings is None:
        result = {"findings": [finding(str(next(p for p in pages if p.status == "observed").pk))]}
    else:
        result = {
            "reviews": [
                {
                    "page_id": f["page_id"],
                    "supported": True,
                    "reason": "Supported by the saved page.",
                }
                for f in findings
            ]
        }
    return {"result": result, "usage": {"input_tokens": 12, "output_tokens": 6}}


@pytest.fixture
def runner_mocks():
    with (
        patch.object(tasks, "browser_ready", return_value=True),
        patch.object(
            tasks,
            "browse",
            side_effect=lambda url, *args: {"status": "ready"} if url is None else evidence(),
        ) as browser,
        patch.object(tasks, "search", return_value=search_result()) as search,
        patch.object(analysis, "call", side_effect=mock_analysis) as model,
    ):
        yield browser, search, model


def test_research_runs_with_sources_usage_and_private_images(api, workspace, setup, runner_mocks):
    url, app, data, run = setup
    tasks.research(str(run.workflow_id))
    run.refresh_from_db()
    assert run.workflow.status == "succeeded"
    assert run.report["coverage"] == {
        "observed": 4,
        "attempted": 4,
        "references_observed": 3,
        "references_expected": 3,
    }
    assert len(run.report["findings"]) == 1
    assert runner_mocks[0].call_count == 5 and runner_mocks[2].call_count == 2
    detail = api.get(f"{url}research/{run.pk}/").data
    assert len(detail["pages"]) == 4 and detail["discovery"]["queries"]
    assert "fake-research-key" not in str(detail) and "connection_id" not in str(detail)
    assert api.get(detail["pages"][0]["images"]["top"]).content == b"test-jpeg"
    assert APIClient().get(detail["pages"][0]["images"]["top"]).status_code == 403
    assert api.get(f"{url}research-pages/{run.pages.first().pk}/invalid/").status_code == 400
    assert run.workflow.events.filter(kind="progress").count() == 8


def test_creation_idempotency_snapshot_and_one_active_session(api, setup):
    url, app, data, run = setup
    # Lost response replay does not consult the now-replaced key or metadata.
    AIConnection.objects.all().delete()
    assert api.post(f"{url}apps/{app.pk}/research/", data, format="json").data["id"] == str(run.pk)
    changed = {**data, "topic": "Different research"}
    assert api.post(f"{url}apps/{app.pk}/research/", changed, format="json").status_code == 409
    assert (
        api.post(
            f"{url}apps/{app.pk}/research/",
            {**data, "request_id": str(uuid.uuid4())},
            format="json",
        ).status_code
        == 400
    )
    assert run.inputs["references"] == discovery.REFERENCES


def test_research_workspace_roles_and_module_disabled(api, workspace, owner, setup):
    url, app, data, run = setup
    Membership.objects.filter(workspace=workspace, user=owner).update(role="viewer")
    assert api.get(f"{url}research/{run.pk}/").status_code == 200
    assert api.post(f"{url}apps/{app.pk}/research/", data, format="json").status_code == 403
    assert (
        api.post(
            f"{url}research/{run.pk}/retry/", {"request_id": str(uuid.uuid4())}, format="json"
        ).status_code
        == 403
    )
    other = Workspace.objects.create(name="Other")
    Membership.objects.create(workspace=other, user=owner, role="owner")
    from panda_store.core.access import activate_modules

    activate_modules(other, ["studio"])
    assert api.get(f"/api/workspaces/{other.pk}/studio/research/{run.pk}/").status_code == 404
    workspace.modules.filter(module_id="studio").delete()
    assert api.get(f"{url}research/{run.pk}/").status_code == 403
    tasks.research(str(run.workflow_id))
    run.workflow.refresh_from_db()
    assert run.workflow.status == "failed"


def test_retry_reuses_browse_and_analysis_when_verifier_times_out(api, setup, runner_mocks):
    url, app, data, run = setup

    def fail_review(run, pages, findings=None):
        if findings is not None:
            raise ProviderError("Provider timed out. May still be billed.", code="timeout")
        return mock_analysis(run, pages)

    with patch.object(analysis, "call", side_effect=fail_review):
        tasks.research(str(run.workflow_id))
    run.workflow.refresh_from_db()
    assert run.workflow.status == "failed" and run.pages.count() == 4
    response = api.post(
        f"{url}research/{run.pk}/retry/", {"request_id": str(uuid.uuid4())}, format="json"
    )
    assert response.status_code == 202
    retry = ResearchRun.objects.get(pk=response.data["id"])
    tasks.research(str(retry.workflow_id))
    retry.refresh_from_db()
    assert retry.workflow.status == "succeeded"
    assert runner_mocks[0].call_count == 5 and runner_mocks[1].call_count == 1
    assert retry.evidence_root == run and retry.pages.count() == 0
    assert len(api.get(f"{url}research/{retry.pk}/").data["pages"]) == 4
    replay = api.post(
        f"{url}research/{run.pk}/retry/", {"request_id": str(uuid.uuid4())}, format="json"
    )
    assert replay.data["id"] == str(retry.pk)


def test_partial_access_does_not_invent_observations(setup, runner_mocks):
    run = setup[-1]
    blocked = {
        **evidence(),
        "status": "unavailable",
        "reason": "Login required.",
        "text": "",
        "images": {},
        "hashes": {},
    }
    with patch.object(
        tasks,
        "browse",
        side_effect=lambda url, *args: (
            {"status": "ready"} if url is None else copy.deepcopy(blocked)
        ),
    ):
        tasks.research(str(run.workflow_id))
    run.refresh_from_db()
    assert run.workflow.status == "succeeded"
    assert run.report["coverage"]["observed"] == 0
    assert run.report["findings"] == [] and runner_mocks[2].call_count == 0


def test_canceled_child_cannot_save_page(setup, runner_mocks):
    run = setup[-1]

    def cancel(url, *args):
        if url is None:
            return {"status": "ready"}
        services.cancel(run.workflow_id)
        return evidence()

    with patch.object(tasks, "browse", side_effect=cancel):
        tasks.research(str(run.workflow_id))
    run.workflow.refresh_from_db()
    assert run.workflow.status == "canceled" and not run.pages.exists()


def test_refresh_unavailable_sources_preserves_original_and_search(api, setup, runner_mocks):
    url, app, data, original = setup

    def first_visit(url, *args):
        if url is None:
            return {"status": "ready"}
        value = evidence()
        if "public.example" in url:
            value.update(status="unavailable", reason="Network unavailable.")
        return value

    with patch.object(tasks, "browse", side_effect=first_visit):
        tasks.research(str(original.workflow_id))
    original.refresh_from_db()
    assert original.report["coverage"]["observed"] == 3
    old = original.pages.filter(status="observed").first()
    response = api.post(
        f"{url}research/{original.pk}/retry/", {"request_id": str(uuid.uuid4())}, format="json"
    )
    assert response.status_code == 202
    retry = ResearchRun.objects.get(pk=response.data["id"])
    copied = retry.pages.get(position=old.position)
    assert copied.pk != old.pk and copied.hashes == old.hashes
    assert copied.captured_at == old.captured_at and copied.source["reused_from"] == str(old.pk)
    tasks.research(str(retry.workflow_id))
    retry.refresh_from_db()
    assert retry.report["coverage"]["observed"] == 4
    assert runner_mocks[1].call_count == 1
    assert runner_mocks[0].call_count == 1  # Only the previously unavailable page.
    original.refresh_from_db()
    assert original.report["coverage"]["observed"] == 3
    assert original.pages.filter(status="unavailable").count() == 1


def test_broken_browser_fails_before_paid_search(setup, runner_mocks):
    run = setup[-1]
    with patch.object(
        tasks, "browse", return_value={"status": "unavailable", "reason": "Sandbox unavailable."}
    ):
        tasks.research(str(run.workflow_id))
    run.workflow.refresh_from_db()
    assert run.workflow.status == "failed" and runner_mocks[1].call_count == 0


@pytest.mark.parametrize(
    "mutate",
    [
        lambda f: f.update(hook_quote="A fabricated hook"),
        lambda f: f.update(evidence_quotes=["Not on the page"]),
        lambda f: f.update(metrics=[{"label": "Installs", "quote": "999 installs"}]),
    ],
)
def test_fabricated_quotes_are_withheld(mutate):
    page = SimpleNamespace(pk="page-one", status="observed", text=evidence()["text"])
    value = finding()
    mutate(value)
    accepted, withheld = analysis.candidates({"result": {"findings": [value]}}, [page])
    assert not accepted and len(withheld) == 1


def test_semantic_reviewer_can_withhold_a_claim_even_with_valid_quotes():
    value = finding()
    value["observation"] = "This viral post guarantees downloads."
    accepted, rejected = analysis.verified(
        [value],
        {
            "result": {
                "reviews": [
                    {
                        "page_id": "page-one",
                        "supported": False,
                        "reason": "Views do not establish installs.",
                    }
                ]
            }
        },
    )
    assert accepted == [] and rejected[0]["reason"]
    with pytest.raises(ProviderError):
        analysis.verified([value], {"result": {"reviews": []}})


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "https://user:password@public.example/",
        "http://public.example:8000/",
        "javascript:alert(1)",
        "https://public.example/\\@127.0.0.1",
        "https://public.example/\nHeader",
    ],
)
def test_url_gate(url):
    assert discovery.public_url(url) is None


@pytest.mark.parametrize(
    "ip",
    ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "fc00::1", "::ffff:127.0.0.1", "192.0.2.1"],
)
def test_private_and_reserved_dns_never_connects(ip):
    with (
        patch(
            "socket.getaddrinfo",
            return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 443))],
        ),
        patch.object(httpcore.SyncBackend, "connect_tcp") as connect,
    ):
        with pytest.raises(AccessBlocked):
            PublicNetwork().connect_tcp("public.example", 443)
        connect.assert_not_called()


def test_checked_ip_is_pinned_and_mixed_dns_is_blocked():
    with (
        patch(
            "socket.getaddrinfo",
            return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))],
        ) as dns,
        patch.object(httpcore.SyncBackend, "connect_tcp") as connect,
    ):
        PublicNetwork().connect_tcp("public.example", 443)
        assert connect.call_args.args[0] == "8.8.8.8" and dns.call_count == 1
    with (
        patch(
            "socket.getaddrinfo",
            return_value=[(2, 1, 6, "", ("8.8.8.8", 443)), (2, 1, 6, "", ("127.0.0.1", 443))],
        ),
        pytest.raises(AccessBlocked),
    ):
        address("public.example", 443)


@pytest.mark.parametrize(
    "provider,model,response",
    [
        (
            "openai",
            "gpt-4.1-mini",
            {
                "status": "completed",
                "output": [
                    {"type": "web_search_call", "action": {"queries": ["running"]}},
                    {
                        "type": "message",
                        "content": [
                            {
                                "type": "output_text",
                                "text": "invented https://fake.example/",
                                "annotations": [
                                    {
                                        "type": "url_citation",
                                        "url": "https://source.example/post",
                                        "title": "Source",
                                    }
                                ],
                            }
                        ],
                    },
                ],
            },
        ),
        (
            "google",
            "gemini-3.8-flash",
            {
                "candidates": [
                    {
                        "finishReason": "STOP",
                        "groundingMetadata": {
                            "webSearchQueries": ["running"],
                            "groundingChunks": [
                                {"web": {"uri": "https://source.example/post", "title": "Source"}}
                            ],
                            "searchEntryPoint": {"renderedContent": "<div>Suggestions</div>"},
                        },
                    }
                ]
            },
        ),
        (
            "anthropic",
            "claude-sonnet-4-5",
            {
                "stop_reason": "end_turn",
                "content": [
                    {
                        "type": "web_search_tool_result",
                        "content": [{"url": "https://source.example/post", "title": "Source"}],
                    }
                ],
            },
        ),
    ],
)
def test_search_adapters_only_use_provider_source_metadata(provider, model, response):
    with patch.object(discovery, "request", return_value=response) as request:
        result = discovery.search(
            provider, "fake-key", model, {"app": "Run"}, response_language="fr"
        )
    assert result["sources"] == [
        {
            "url": "https://source.example/post",
            "title": "Source",
            "kind": "discovered",
            "domain": "",
        }
    ]
    assert "fake.example" not in str(result)
    payload = request.call_args.kwargs["payload"]
    instruction = (
        payload["instructions"]
        if provider == "openai"
        else payload["system"]
        if provider == "anthropic"
        else payload["systemInstruction"]["parts"][0]["text"]
    )
    assert "Response language: French (fr)." in instruction
    if provider == "google":
        assert request.call_args.args[2] == f"/models/{model}:generateContent"
    else:
        assert request.call_args.kwargs["payload"]["model"] == model


def test_search_without_tool_sources_is_not_a_completed_search():
    with (
        patch.object(
            discovery,
            "request",
            return_value={
                "status": "completed",
                "output": [
                    {"type": "message", "content": [{"text": "Look at https://invented.example/"}]}
                ],
            },
        ),
        pytest.raises(ProviderError, match="no searchable source"),
    ):
        discovery.search("openai", "fake-key", "gpt-4.1-mini", {})


def test_real_browser_renders_scrolls_and_resolves_provider_redirects():
    from addons.studio import research_browser

    if not tasks.browser_ready():
        pytest.skip("Install Chromium to run the browser integration test.")
    # Expose launch diagnostics in CI before capture() turns failures into a safe UI message.
    with research_browser.sync_playwright() as playwright:
        browser = research_browser.launch(playwright, playwright.chromium.executable_path)
        browser.close()
    requests = []

    def fetch(_self, url, **kwargs):
        requests.append(url)
        if url.endswith("/robots.txt"):
            return 200, {}, b"User-agent: *\nAllow: /"
        if url == "https://vertexaisearch.cloud.google.com/grounding-api-redirect/test":
            return 302, {"location": "https://public.example/"}, b""
        if url == "https://public.example/":
            return (
                200,
                {"content-type": "text/html"},
                b'<html><title>Running fixture</title><body style="min-height:2500px">'
                b"<h1>Plan a short run</h1><p>Start with ten minutes and follow your own pace. "
                b"This is a deterministic browser fixture with enough text "
                b'for the research capture.</p><iframe src="https://blocked.example/">'
                b"</iframe></body></html>",
            )
        raise AccessBlocked("Unapproved fixture URL")

    with patch.object(research_browser.PublicClient, "fetch", fetch):
        result = research_browser.capture(
            "https://vertexaisearch.cloud.google.com/grounding-api-redirect/test",
            tasks.browser_path(),
        )
    assert result["status"] == "observed", result["reason"]
    assert set(result["images"]) == {"top", "scroll"}
    assert any(event.get("y", 0) > 0 for event in result["trace"])
    assert "Plan a short run" in result["text"]
    assert set(requests) == {
        "https://vertexaisearch.cloud.google.com/grounding-api-redirect/test",
        "https://public.example/robots.txt",
        "https://public.example/",
    }
    assert result["trace"][0]["action"] == "resolve_provider_link"
