import base64
import copy
import io
import uuid
from unittest.mock import patch

import pytest
from PIL import Image
from rest_framework.exceptions import ValidationError

from addons.app_catalog.models import MobileApp
from addons.studio import creative_ai, social_tasks
from addons.studio.creative_tasks import generate_ai_scripts
from addons.studio.models import GenerationRun, SocialPost, SocialResearch
from addons.studio.social_evidence import count, post_url, qualify, validate_capture
from panda_store.ai.providers import ProviderError
from panda_store.ai.usage import operation
from panda_store.core.credentials import encrypt
from panda_store.core.models import AIConnection, Membership, Workspace
from panda_store.workflows import services


def jpeg_frame(size=(2400, 1300), fmt="JPEG"):
    output = io.BytesIO()
    Image.new("RGB", size, "blue").save(output, fmt, optimize=True)
    return base64.b64encode(output.getvalue()).decode("ascii")


@pytest.mark.parametrize("size", [(2400, 1300), (2880, 1800), (3600, 2400), (1200, 1600)])
def test_retina_evidence_is_readable_bounded_and_preserves_the_whole_viewport(size):
    raw = evidence()
    frame = jpeg_frame(size)
    raw["frames"] = [frame]
    clean, metrics, frames = validate_capture(raw)
    assert metrics["likes"]["value"] == 2000
    assert clean["url"] == raw["url"]
    assert len(frames[0]) <= 275000
    with Image.open(io.BytesIO(base64.b64decode(frames[0]))) as image:
        image.load()
        assert image.format == "JPEG"
        assert image.width <= 1200 and image.height <= 1600
        assert abs(image.width / image.height - size[0] / size[1]) < 0.01
    if size == (1200, 1600):
        assert frames[0] == frame
        assert clean["coverage"] == raw["coverage"]
    else:
        assert "resized" in clean["coverage"]


@pytest.mark.parametrize(
    "kind", ["png", "truncated", "invalid_base64", "too_many_pixels", "too_many_bytes"]
)
def test_invalid_or_excessive_image_evidence_is_still_rejected(kind):
    raw = evidence()
    frame = jpeg_frame((64, 64))
    message = "Invalid JPEG evidence"
    if kind == "png":
        frame = jpeg_frame((64, 64), "PNG")
    elif kind == "truncated":
        frame = base64.b64encode(base64.b64decode(frame)[:-12]).decode("ascii")
    elif kind == "invalid_base64":
        frame = "not valid base64!"
    elif kind == "too_many_pixels":
        frame = jpeg_frame((5200, 4000))
        assert len(frame) < 275000
        message = "resolution is too large"
    else:
        frame = "x" * 275001
        message = "frame is too large"
    raw["frames"] = [frame]
    with pytest.raises(ValidationError, match=message):
        validate_capture(raw)


def evidence(number=1, fmt="video", views="25K", likes="2K"):
    kind = "photo" if fmt == "carousel" else "video"
    return {
        "url": f"https://www.tiktok.com/@runner/{kind}/{number}",
        "format": fmt,
        "title": f"Running idea {number}",
        "caption": "A short run.",
        "text": f"A short run. {views} views, {likes} likes",
        "author": "runner",
        "coverage": "Three sampled frames. No audio or complete video.",
        "metrics": {
            "views": {"raw": views, "quote": f"{views} views"},
            "likes": {"raw": likes, "quote": f"{likes} likes"},
        },
        "frames": [],
    }


@pytest.mark.parametrize("platform", ["tiktok", "instagram", "facebook"])
def test_native_search_plan_rejects_google_syntax(platform):
    for query in [
        'site:facebook.com "photo cleaner"',
        "photos OR camera roll",
        "https://example.com",
    ]:
        output = {
            "result": {
                "queries": [{"platform": platform, "query": query, "reason": "Niche"}],
                "strategy": "Find similar apps",
            }
        }
        with pytest.raises(ProviderError, match="plain keywords"):
            social_tasks.validate_plan(output, [platform])
    output["result"]["queries"][0]["query"] = "swipe photo cleaner app"
    assert (
        social_tasks.validate_plan(output, [platform])["queries"][0]["query"]
        == "swipe photo cleaner app"
    )
    output["result"]["queries"][0].update(
        platform="google", query='site:facebook.com "photo cleaner"'
    )
    assert any(
        item["query"].startswith("site:facebook.com ")
        for item in social_tasks.validate_plan(output, ["google"])["queries"]
    )


def test_google_plan_separates_networks_and_keeps_both_search_angles():
    output = {
        "result": {
            "queries": [
                {"platform": "google", "query": "My Talking Tom routine", "reason": "Similar app"},
                {"platform": "google", "query": "jeu cosy décoration", "reason": "Broader niche"},
            ],
            "strategy": "Look for similar apps and broader niche content.",
        }
    }
    queries = social_tasks.validate_plan(output, ["google"])["queries"]
    assert len(queries) == 6
    for site in ("tiktok.com", "instagram.com", "facebook.com"):
        scoped = [q for q in queries if q["query"].startswith(f"site:{site} ")]
        assert {q["reason"] for q in scoped} == {"Similar app", "Broader niche"}
        assert all(q["query"].count("site:") == 1 and len(q["query"]) <= 160 for q in scoped)
    # All chosen networks remain represented when native searches share the budget.
    output["result"]["queries"] += [
        {"platform": p, "query": "animal virtuel routine", "reason": "Native search"}
        for p in ("tiktok", "instagram", "facebook")
    ]
    queries = social_tasks.validate_plan(output, ["google", "tiktok", "instagram", "facebook"])[
        "queries"
    ]
    assert len(queries) == 6
    assert {q["platform"] for q in queries} == {"google", "tiktok", "instagram", "facebook"}
    assert {q["query"].split()[0] for q in queries if q["platform"] == "google"} == {
        "site:tiktok.com",
        "site:instagram.com",
        "site:facebook.com",
    }
    assert {q["reason"] for q in queries if q["platform"] == "google"} == {
        "Similar app",
        "Broader niche",
    }


@pytest.mark.parametrize(
    "query",
    [
        '("My Talking Tom" OR Pou) (site:tiktok.com OR site:instagram.com OR site:facebook.com)',
        'site:facebook.com ("My Talking Tom" OR Pou)',
        '("My Talking Tom" OR Pou) site:instagram.com',
    ],
)
def test_google_plan_normalizes_old_site_filters_without_losing_topic(query):
    result = social_tasks.google_searches(
        [{"platform": "google", "query": query, "reason": "Similar apps"}]
    )
    assert len(result) == 3
    for item in result:
        assert item["query"].count("site:") == 1
        assert item["query"].endswith('("My Talking Tom" OR Pou)')


def test_google_plan_deduplicates_and_rejects_empty_or_overlong_topics():
    query = {"platform": "google", "query": "animal virtuel", "reason": "Niche"}
    assert len(social_tasks.google_searches([query, query])) == 3
    for terms in ["site:facebook.com", "x" * 141]:
        with pytest.raises(ProviderError, match="short topic keywords"):
            social_tasks.google_searches([{**query, "query": terms}])


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("1.2K", 1200),
        ("1,2 M", 1200000),
        ("12,345", 12345),
        ("12 345", 12345),
        ("2万", 20000),
        ("0", 0),
        ("1.234", None),
        ("-2", None),
        ("120 likes", None),
        ("1,2,3K", None),
        ("1e9", None),
        (True, None),
        ("2.3.4", None),
    ],
)
def test_counts_are_conservative(raw, expected):
    assert count(raw) == expected


@pytest.mark.parametrize(
    "url",
    [
        "http://www.tiktok.com/@a/video/1",
        "https://www.tiktok.com.evil.test/@a/video/1",
        "https://www.tiktok.com/",
        "https://www.tiktok.com:443/@a/video/1",
        "https://user@www.tiktok.com/@a/video/1",
        "https://localhost/@a/video/1",
        "https://www.facebook.com/watch/?v=x&token=secret",
    ],
)
def test_only_direct_supported_posts(url):
    with pytest.raises(ValidationError):
        post_url(url)


def test_facebook_page_permalink_preserves_both_identifiers():
    raw = "https://www.facebook.com/permalink.php?id=61593971734574&story_fbid=pfbid034GTbF4uCW6JTb&tracking=x"
    assert post_url(raw) == (
        "facebook",
        "https://www.facebook.com/permalink.php?story_fbid=pfbid034GTbF4uCW6JTb&id=61593971734574",
    )
    for query in [
        "id=123",
        "story_fbid=pfbid123",
        "story_fbid=bad&id=123",
        "story_fbid=123&id=abc",
        "story_fbid=123&id=1&id=2",
        "story_fbid=123&story_fbid=456&id=1",
    ]:
        with pytest.raises(ValidationError):
            post_url("https://www.facebook.com/permalink.php?" + query)


@pytest.mark.parametrize("static_format", ["carousel", "image", "text"])
def test_qualification_requires_real_counters_and_distinguishes_formats(static_format):
    raw = evidence()
    raw["metrics"]["views"]["quote"] = "invented 25K views"
    clean, metrics, _ = validate_capture(raw)
    assert "views" not in metrics
    assert (
        qualify(clean, metrics, {"min_views": 10000, "min_likes": 500})["status"] == "unqualified"
    )
    assert (
        qualify(
            clean, metrics, {"min_views": 10000, "min_likes": 500}, content_format=static_format
        )["status"]
        == "metrics_pass"
    )
    clean["blocked_reason"] = "Sign in"
    assert (
        qualify(
            clean, metrics, {"min_views": 10000, "min_likes": 500}, content_format=static_format
        )["status"]
        == "unqualified"
    )


def test_legacy_search_card_counter_cannot_qualify_a_video_as_viewed():
    raw = evidence()
    quote = f"Search card for {raw['url']}: 25K views"
    raw["text"] = "A short run. 2K likes\n" + quote
    raw["metrics"]["views"]["quote"] = quote
    clean, metrics, _ = validate_capture(raw)
    assert "views" not in metrics
    assert "views" not in clean["metrics"]
    result = qualify(clean, metrics, {"min_views": 10000, "min_likes": 500})
    assert result["status"] == "unqualified"
    assert "Views were not observed." in result["reasons"]


@pytest.fixture
def setup(api, workspace, imported, settings):
    settings.PANDA_WORKFLOW_DISPATCH = "database"
    app = MobileApp.objects.get(pk=imported["id"])
    AIConnection.objects.create(
        workspace=workspace,
        provider="openai",
        encrypted_key=encrypt("test-social-key"),
        model_catalog=[{"id": "gpt-4.1-mini"}],
    )
    base = f"/api/workspaces/{workspace.pk}/studio/"
    request = {
        "request_id": str(uuid.uuid4()),
        "snapshot_id": str(app.snapshots.first().pk),
        "topic": "Running apps for beginners",
        "market": "en-US",
        "platforms": ["tiktok"],
        "min_views": 10000,
        "min_likes": 500,
        "provider": "openai",
        "model": "gpt-4.1-mini",
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
    response = api.post(base + f"apps/{app.pk}/social-research/", request, format="json")
    assert response.status_code == 202, response.data
    session = SocialResearch.objects.get(pk=response.data["id"])
    return base, app, request, session


def planned(session):
    plan = {
        "queries": [{"platform": "tiktok", "query": "beginner running app", "reason": "Niche"}],
        "strategy": "Compare runner content.",
    }
    with patch.object(social_tasks, "call", return_value={"result": plan}):
        social_tasks.research(str(session.workflow_id))
    session.refresh_from_db()
    assert session.status == "ready"


@pytest.mark.parametrize("origin", ["ios", "android", "idea"])
def test_automatic_context_uses_complete_saved_description_and_one_planning_call(
    api, setup, origin
):
    base, app, body, _ = setup
    snapshot = app.snapshots.first()
    facts = "Planifier un repas avec ses ingrédients. " * 120 + "Les rappels sont facultatifs."
    snapshot.data = {"name": "Cuisine", "locale": "fr-FR"}
    if origin == "idea":
        snapshot.data["project"] = {
            "origin": "project",
            "stage": "idea",
            "specification": facts,
            "audience": "",
        }
    else:
        snapshot.data.update(platform=origin, description=facts)
    snapshot.save()
    body = {
        **body,
        "request_id": str(uuid.uuid4()),
        "context_mode": "app",
        "facts_confirmed": False,
        "brief": {**body["brief"], "audience": "", "product_facts": ""},
    }
    response = api.post(f"{base}apps/{app.pk}/social-research/", body, format="json")
    assert response.status_code == 202, response.data
    session = SocialResearch.objects.get(pk=response.data["id"])
    frozen_facts = session.inputs["brief"]["product_facts"]
    assert facts in frozen_facts and len(frozen_facts) > 4000
    assert session.inputs["context_origin"] == {"product_facts": "snapshot", "audience": "pending"}
    plan = {
        "queries": [
            {"platform": "tiktok", "query": "recettes ingrédients frigo", "reason": "Niche"}
        ],
        "strategy": "Chercher des recettes simples.",
        "app_understanding": {
            "audience": "Personnes qui cuisinent avec les ingrédients disponibles",
            "features": [
                "Planifier un repas avec ses ingrédients.",
                "Les rappels sont facultatifs.",
            ],
        },
    }
    with patch.object(social_tasks, "call", return_value={"result": plan}) as model:
        social_tasks.research(str(session.workflow_id))
    assert model.call_count == 1
    assert model.call_args.args[2]["brief"]["product_facts"] == frozen_facts
    assert model.call_args.args[3] == social_tasks.CONTEXT_PLAN
    session.refresh_from_db()
    assert session.status == "ready"
    assert session.inputs["brief"]["product_facts"] == frozen_facts
    assert session.inputs["brief"]["audience"] == plan["app_understanding"]["audience"]
    assert session.inputs["context_origin"]["audience"] == "ai"
    if origin == "idea":
        assert session.inputs["app_context"]["stage"] == "idea"
    # A request replay still compares the submitted inputs, not the derived audience.
    replay = api.post(f"{base}apps/{app.pk}/social-research/", body, format="json")
    assert str(replay.data["id"]) == str(session.pk)
    assert session.request["brief"]["audience"] == ""
    # New imports must not rewrite the saved source used for analysis and adaptations.
    snapshot.data["description"] = "A completely different app description."
    snapshot.save()
    url = f"{base}social-research/{session.pk}/"
    assert api.post(url, {"action": "browse"}, format="json").status_code == 200
    captured = api.post(url + "captures/", evidence(1, "carousel"), format="json")
    assert captured.status_code == 200
    finished = api.post(url, {"action": "finish"}, format="json")
    with patch.object(social_tasks, "call", side_effect=fake_analysis) as model:
        social_tasks.research(finished.data["workflow_id"])
    assert all(
        c.args[2]["brief"]["audience"] == plan["app_understanding"]["audience"]
        for c in model.call_args_list
    )
    adapted = api.post(
        url + "adapt/",
        {"request_id": str(uuid.uuid4()), "post_ids": [str(session.posts.get().pk)]},
        format="json",
    )
    assert adapted.status_code == 202, adapted.data
    run = GenerationRun.objects.get(pk=adapted.data["id"])
    assert run.inputs["brief"]["product_facts"] == frozen_facts
    assert run.inputs["brief"]["audience"] == plan["app_understanding"]["audience"]


def test_automatic_context_keeps_explicit_overrides_and_rejects_missing_descriptions(api, setup):
    base, app, body, _ = setup
    snapshot = app.snapshots.first()
    snapshot.data = {"name": "A name is not a product description"}
    snapshot.save()
    body = {
        **body,
        "request_id": str(uuid.uuid4()),
        "context_mode": "app",
        "facts_confirmed": False,
    }
    response = api.post(f"{base}apps/{app.pk}/social-research/", body, format="json")
    assert response.status_code == 202, response.data
    session = SocialResearch.objects.get(pk=response.data["id"])
    assert session.inputs["brief"] == body["brief"]
    assert session.inputs["context_origin"] == {"product_facts": "user", "audience": "user"}
    body.update(
        request_id=str(uuid.uuid4()), brief={**body["brief"], "audience": "", "product_facts": ""}
    )
    response = api.post(f"{base}apps/{app.pk}/social-research/", body, format="json")
    assert response.status_code == 400 and "Add an app description" in str(response.data)
    body.update(request_id=str(uuid.uuid4()), context_mode="manual")
    assert api.post(f"{base}apps/{app.pk}/social-research/", body, format="json").status_code == 400


def test_context_extraction_rejects_invented_features_and_preserves_custom_audience():
    brief = {
        "audience": "Home cooks",
        "product_facts": "The app suggests recipes. Reminders are optional.",
    }
    output = {
        "result": {
            "app_understanding": {
                "audience": "A different audience",
                "features": ["Reminders are optional."],
            }
        }
    }
    assert social_tasks.validate_app_understanding(output, brief)["audience"] == "Home cooks"
    output["result"]["app_understanding"]["features"] = ["The app scans receipts automatically."]
    with pytest.raises(ProviderError, match="do not match"):
        social_tasks.validate_app_understanding(output, brief)


def test_skipped_post_activity_keeps_a_safe_source_link(api, setup):
    base, _, _, session = setup
    planned(session)
    url = base + f"social-research/{session.pk}/"
    assert api.post(url, {"action": "browse"}, format="json").status_code == 200
    body = {
        "action": "event",
        "message": "Skipped a post whose content could not be loaded.",
        "url": "https://www.tiktok.com/@runner/video/123?tracking=discard",
    }
    response = api.post(url, body, format="json")
    assert response.status_code == 200
    assert response.data["events"][-1]["url"] == "https://www.tiktok.com/@runner/video/123"
    assert not session.posts.exists()
    for unsafe in ("javascript:alert(1)", "https://example.com/private", {"url": "bad"}):
        assert api.post(url, {**body, "url": unsafe}, format="json").status_code == 400
    session.refresh_from_db()
    assert session.events[-1]["url"] == "https://www.tiktok.com/@runner/video/123"


def fake_analysis(session, instruction, context, schema, images=None):
    if instruction == social_tasks.VERIFY_INSTRUCTION:
        return {"result": {"supported": True, "reason": "Matches the captured evidence."}}
    return {
        "result": {
            "relevant": True,
            "relevance_reason": "Running niche matches the app.",
            "format": context["post"]["format"],
            "hook_quote": "A short run.",
            "observation": "A short run is introduced.",
            "structure": "One introductory prompt.",
            "idea_to_test": "Show a small run plan.",
            "evidence_quotes": ["A short run."],
            "limitations": ["Audio and complete sequence were not observed."],
        },
        "usage": {"input_tokens": 8},
    }


def collect(api, base, session, static_format="carousel"):
    planned(session)
    url = base + f"social-research/{session.pk}/"
    assert api.post(url, {"action": "browse"}, format="json").status_code == 200
    for n, fmt in [(1, "video"), (2, static_format), (3, "video"), (4, "video")]:
        response = api.post(
            url + "captures/", evidence(n, fmt, likes="20" if n == 4 else "2K"), format="json"
        )
        assert response.status_code == 200, response.data
    return url


@pytest.mark.parametrize("phase", ["plan", "analyze"])
def test_social_retry_can_change_provider_without_losing_evidence_or_resetting_budget(
    api, setup, phase
):
    base, _, _, original = setup
    url = base + f"social-research/{original.pk}/"
    if phase == "analyze":
        collect(api, base, original)
        result = api.post(url, {"action": "finish"}, format="json")

        def interrupted(*args, **kwargs):
            if args[2]["post"]["url"].endswith("/2"):
                raise ProviderError("Provider interrupted")
            return fake_analysis(*args, **kwargs)

        with patch.object(social_tasks, "call", side_effect=interrupted):
            social_tasks.research(result.data["workflow_id"])
        original.refresh_from_db()
        assert original.posts.filter(qualification__status="qualified").count() == 1
    else:
        services.fail(original.workflow_id, "Provider interrupted")
    saved_inputs = copy.deepcopy(original.inputs)
    saved_posts = list(
        original.posts.values("url", "evidence", "metrics", "frames", "analysis", "captured_at")
    )
    AIConnection.objects.create(
        workspace=original.workspace,
        provider="google",
        encrypted_key=encrypt("test-google"),
        model_catalog=[{"id": "gemini-2.5-flash"}],
    )
    body = {
        "action": "retry",
        "request_id": str(uuid.uuid4()),
        "provider": "google",
        "model": "gemini-2.5-flash",
    }
    result = api.post(url, body, format="json")
    assert result.status_code == 200, result.data
    fork = SocialResearch.objects.get(pk=result.data["id"])
    assert fork.pk != original.pk
    assert fork.inputs["ai"]["provider"] == "google"
    assert fork.inputs["brief"] == original.inputs["brief"]
    assert fork.plan == original.plan
    assert (
        operation(fork, "studio", "social")["operation_key"]
        == operation(original, "studio", "social")["operation_key"]
    )
    assert api.post(url, body, format="json").data["id"] == str(fork.pk)
    assert (
        api.post(
            url, {**body, "provider": "openai", "model": "gpt-4.1-mini"}, format="json"
        ).status_code
        == 409
    )
    assert SocialResearch.objects.count() == 2
    for copied, saved in zip(fork.posts.all(), saved_posts, strict=True):
        assert copied.analysis == {}
        for field in ("url", "evidence", "metrics", "frames", "captured_at"):
            assert getattr(copied, field) == saved[field]
    original.refresh_from_db()
    assert original.inputs == saved_inputs
    assert (
        list(
            original.posts.values("url", "evidence", "metrics", "frames", "analysis", "captured_at")
        )
        == saved_posts
    )
    if phase == "analyze":
        with patch.object(social_tasks, "call", side_effect=fake_analysis) as calls:
            social_tasks.research(str(fork.workflow_id))
        assert calls.call_count == 6
        fork.refresh_from_db()
        assert fork.status == "completed"
    else:
        assert fork.status == "planning"
        assert fork.workflow.steps.get().key == "plan"


@pytest.fixture
def split_research(api, setup):
    base, app, request, source = setup
    url = collect(api, base, source)
    response = api.post(url, {"action": "finish"}, format="json")
    with patch.object(social_tasks, "call", side_effect=fake_analysis):
        social_tasks.research(response.data["workflow_id"])
    source.refresh_from_db()
    target = SocialResearch.objects.create(
        workspace=source.workspace,
        app=app,
        created_by=source.created_by,
        request_id=uuid.uuid4(),
        request={},
        inputs=copy.deepcopy(source.inputs),
        status="completed",
    )
    posts = list(source.posts.filter(qualification__status="qualified"))
    posts[0].research = target
    posts[0].save(update_fields=["research"])
    return base, source, target, posts


@pytest.mark.django_db
@pytest.mark.parametrize("selection_count", [1, 2, 3])
def test_adapt_reuses_compatible_research_with_frozen_provenance(
    api, split_research, selection_count
):
    base, source, target, posts = split_research
    url = base + f"social-research/{target.pk}/"
    library = api.get(url + "references/")
    assert library.status_code == 200
    assert {p["id"] for p in library.data["posts"]} == {str(p.pk) for p in posts[1:]}
    assert {p["research_id"] for p in library.data["posts"]} == {str(source.pk)}
    ordered = [posts[1], posts[0], posts[2]][:selection_count]
    body = {"request_id": str(uuid.uuid4()), "post_ids": [str(p.pk) for p in ordered]}
    response = api.post(url + "adapt/", body, format="json")
    assert response.status_code == 202, response.data
    sources = response.data["context"]["sources"]
    assert [s["page_id"] for s in sources] == body["post_ids"]
    assert [s["research_id"] for s in sources] == [str(p.research_id) for p in ordered]
    assert [s["format"] for s in sources] == ["carousel", "video", "video"][:selection_count]
    assert all(s["platform"] == "tiktok" and s["metrics"] for s in sources)
    assert api.post(url + "adapt/", body, format="json").data["id"] == response.data["id"]
    posts[1].analysis["observation"] = "Changed after generation"
    posts[1].save(update_fields=["analysis"])
    run = GenerationRun.objects.get(pk=response.data["id"])
    assert run.inputs["sources"][0]["finding"]["observation"] != "Changed after generation"
    run.inputs["sources"][0]["finding"]["corrections"] = [
        {"previous_idea": "An unsupported promise that was removed."}
    ]
    frozen = copy.deepcopy(run.inputs)
    with patch.object(creative_ai, "generate", return_value={}) as provider:
        creative_ai.call(run)
    model_context = provider.call_args.args[4]
    assert model_context["adaptation_count"] == selection_count
    assert "corrections" not in model_context["sources"][0]["finding"]
    assert "unsupported promise" not in str(model_context)
    assert run.inputs == frozen


@pytest.mark.django_db
@pytest.mark.parametrize("selection", [[], [0, 1, 2, 3], [0, 0], [0, "missing"], ["rejected"]])
def test_adaptation_rejects_empty_excessive_duplicate_or_ineligible_selections(
    api, split_research, selection
):
    base, source, target, posts = split_research
    rejected = source.posts.get(qualification__status="unqualified")
    ids = [
        str(posts[item].pk)
        if isinstance(item, int) and item < len(posts)
        else str(rejected.pk)
        if item == "rejected"
        else str(uuid.uuid4())
        for item in selection
    ]
    response = api.post(
        base + f"social-research/{target.pk}/adapt/",
        {"request_id": str(uuid.uuid4()), "post_ids": ids},
        format="json",
    )
    assert response.status_code == 400
    assert not GenerationRun.objects.exists()


@pytest.mark.django_db
@pytest.mark.parametrize(
    "mismatch", ["features", "audience", "market", "snapshot", "status", "app", "workspace"]
)
def test_cross_research_references_require_same_app_and_context(api, split_research, mismatch):
    base, source, target, posts = split_research
    if mismatch == "features":
        source.inputs["brief"]["product_facts"] = "An older feature description."
    elif mismatch == "audience":
        source.inputs["brief"]["audience"] = "Experienced marathon runners"
    elif mismatch == "market":
        source.inputs["market"] = "fr-FR"
    elif mismatch == "snapshot":
        source.inputs["snapshot_id"] = str(uuid.uuid4())
    elif mismatch == "status":
        source.status = "stopped"
    elif mismatch == "app":
        source.app = MobileApp.objects.create(workspace=source.workspace, name="Other app")
    else:
        source.workspace = Workspace.objects.create(name="Private workspace")
    source.save()
    url = base + f"social-research/{target.pk}/"
    assert api.get(url + "references/").data["posts"] == []
    response = api.post(
        url + "adapt/",
        {"request_id": str(uuid.uuid4()), "post_ids": [str(p.pk) for p in posts]},
        format="json",
    )
    assert response.status_code == 400
    assert not GenerationRun.objects.exists()


@pytest.mark.django_db
def test_reuse_rechecks_metrics_review_and_deduplicates_urls(api, split_research):
    base, source, target, posts = split_research
    url = base + f"social-research/{target.pk}/"
    duplicate = SocialPost.objects.create(
        research=target,
        url=posts[1].url,
        evidence=posts[1].evidence,
        metrics=posts[1].metrics,
        qualification=posts[1].qualification,
        analysis=posts[1].analysis,
    )
    assert [p["id"] for p in api.get(url + "references/").data["posts"]] == [str(posts[2].pk)]
    response = api.post(
        url + "adapt/",
        {
            "request_id": str(uuid.uuid4()),
            "post_ids": [str(p.pk) for p in [duplicate, posts[1], posts[2]]],
        },
        format="json",
    )
    assert response.status_code == 400  # Distinct IDs must not disguise the same URL.
    target.inputs["min_views"] = 100000
    target.save()
    assert api.get(url + "references/").data["posts"] == []
    target.inputs["min_views"] = 10000
    target.save()
    posts[2].analysis["review"]["supported"] = False
    posts[2].save(update_fields=["analysis"])
    assert api.get(url + "references/").data["posts"] == []
    assert not GenerationRun.objects.exists()


@pytest.mark.django_db
def test_generated_audience_rewording_reuses_sources_without_changing_saved_context(
    api, split_research
):
    base, source, target, posts = split_research
    for session in (source, target):
        session.inputs["context_mode"] = "app"
        session.inputs["context_origin"] = {"audience": "ai", "product_facts": "snapshot"}
    target.inputs["brief"]["audience"] = "People starting their first running routine"
    source.save()
    target.save()
    before = copy.deepcopy(target.inputs)
    url = base + f"social-research/{target.pk}/"
    library = api.get(url + "references/")
    assert {p["id"] for p in library.data["posts"]} == {str(p.pk) for p in posts[1:]}
    response = api.post(
        url + "adapt/",
        {
            "request_id": str(uuid.uuid4()),
            "post_ids": [str(posts[1].pk)],
        },
        format="json",
    )
    assert response.status_code == 202, response.data
    run = GenerationRun.objects.get(pk=response.data["id"])
    assert run.inputs["brief"]["audience"] == before["brief"]["audience"]
    assert run.inputs["sources"][0]["research_id"] == str(source.pk)
    target.refresh_from_db()
    assert target.inputs == before


@pytest.mark.django_db
@pytest.mark.parametrize(
    "mismatch",
    ["topic", "language", "source_manual", "target_manual", "facts", "market", "snapshot"],
)
def test_generated_audience_reuse_still_requires_same_targeting_inputs(
    api, split_research, mismatch
):
    base, source, target, posts = split_research
    for session in (source, target):
        session.inputs["context_mode"] = "app"
        session.inputs["context_origin"] = {"audience": "ai", "product_facts": "snapshot"}
    target.inputs["brief"]["audience"] = "People starting their first running routine"
    if mismatch == "topic":
        source.inputs["topic"] = "Running content for expert marathon runners"
    elif mismatch == "language":
        source.inputs["brief"]["language"] = "Spanish"
    elif mismatch == "source_manual":
        source.inputs["context_origin"]["audience"] = "user"
    elif mismatch == "target_manual":
        target.inputs["context_origin"]["audience"] = "user"
    elif mismatch == "facts":
        source.inputs["brief"]["product_facts"] = "Different app capabilities"
    elif mismatch == "market":
        source.inputs["market"] = "es-ES"
    else:
        source.inputs["snapshot_id"] = str(uuid.uuid4())
    source.save()
    target.save()
    url = base + f"social-research/{target.pk}/"
    assert api.get(url + "references/").data["posts"] == []
    response = api.post(
        url + "adapt/",
        {
            "request_id": str(uuid.uuid4()),
            "post_ids": [str(posts[1].pk)],
        },
        format="json",
    )
    assert response.status_code == 400


@pytest.mark.django_db
@pytest.mark.parametrize("static_format", ["carousel", "image"])
@pytest.mark.parametrize("selection_count", [1, 2, 3])
def test_end_to_end_distinct_sources_and_formats(api, setup, static_format, selection_count):
    base, app, request, session = setup
    url = collect(api, base, session, static_format)
    response = api.post(url, {"action": "finish"}, format="json")
    with patch.object(social_tasks, "call", side_effect=fake_analysis) as calls:
        social_tasks.research(response.data["workflow_id"])
    assert calls.call_count == 6  # Low-like post is never sent to the model.
    result = api.get(url).data
    assert result["status"] == "completed"
    qualified = [p for p in result["posts"] if p["qualification"]["status"] == "qualified"]
    assert len(qualified) == 3
    body = {
        "request_id": str(uuid.uuid4()),
        "post_ids": [p["id"] for p in qualified[:selection_count]],
    }
    response = api.post(url + "adapt/", body, format="json")
    assert response.data["context"]["mode"] == "smm"
    assert response.status_code == 202, response.data
    again = api.post(url + "adapt/", body, format="json")
    assert again.data["id"] == response.data["id"]
    run = GenerationRun.objects.get(pk=response.data["id"])
    assert run.inputs["mode"] == "smm"
    assert [s["format"] for s in run.inputs["sources"]] == ["video", static_format, "video"][
        :selection_count
    ]
    scripts = [
        {
            "variant": i + 1,
            "angle": f"Angle {i}",
            "hook": f"Question {i}?",
            "script": [
                "Film a runner checking a map.",
                "Slide 1: Your first step. Slide 2: A route."
                if static_format == "carousel"
                else "One image: a running route. Caption: Your first step starts here.",
                "Show someone choosing their running shoes.",
            ][i],
            "cta": "Try a run.",
            "source_page_ids": [source["page_id"]],
            "content_format": source["format"],
            "adaptation": "Apply the observed introductory structure.",
            "product_claims": [],
        }
        for i, source in enumerate(run.inputs["sources"])
    ]
    assert creative_ai.validate_scripts({"result": {"scripts": scripts}}, run.inputs) == scripts
    wrong = copy.deepcopy(scripts)
    wrong[0]["content_format"] = "text"
    with pytest.raises(ProviderError):
        creative_ai.validate_scripts({"result": {"scripts": wrong}}, run.inputs)
    wrong = copy.deepcopy(scripts)
    wrong[0]["source_page_ids"] = ["unselected-source"]
    with pytest.raises(ProviderError):
        creative_ai.validate_scripts({"result": {"scripts": wrong}}, run.inputs)
    with patch.object(
        creative_ai,
        "call",
        side_effect=[
            {"result": {"scripts": scripts}},
            {
                "result": {
                    "checks": [
                        {"variant": i, "supported": True, "reason": "Supported"}
                        for i in range(1, selection_count + 1)
                    ]
                }
            },
        ],
    ):
        generate_ai_scripts(str(run.pk))
    run.refresh_from_db()
    assert run.workflow.status == "succeeded"
    assert run.creatives.count() == selection_count
    if selection_count >= 2:
        assert run.creatives.get(variant=2).provenance["content_format"] == static_format
    export = api.get(base + f"runs/{run.pk}/export/")
    assert export.status_code == 200
    text = export.content.decode()
    for source in run.inputs["sources"]:
        assert source["url"] in text
        assert source["research_id"] in text
        assert source["coverage"] in text
    if selection_count >= 2:
        assert f"Format: {static_format}" in text
    assert "Observed views: ≈ 25,000 (label: 25K)" in text
    assert "Observed comments: Not observed" in text
    assert "Audio and complete sequence were not observed." in text
    assert "video only; not applicable to carousel, image or text" in text
    assert run.inputs["brief"]["product_facts"] in text
    assert "Review: needs review" in text


@pytest.mark.django_db
def test_captures_are_idempotent_frozen_and_scoped(api, setup, owner):
    base, app, request, session = setup
    url = collect(api, base, session)
    raw = evidence(1, views="999M")
    assert api.post(url + "captures/", raw, format="json").status_code == 200
    assert session.posts.count() == 4
    assert session.posts.first().metrics["views"]["value"] == 25000
    other = Workspace.objects.create(name="Other")
    foreign = url.replace(str(session.workspace_id), str(other.pk))
    assert api.get(foreign).status_code == 404
    member = Membership.objects.get(user=owner, workspace=session.workspace)
    member.role = "viewer"
    member.save()
    assert api.post(url + "captures/", evidence(5), format="json").status_code == 403
    member.role = "owner"
    member.save()
    assert api.post(url, {"action": "finish"}, format="json").status_code == 200
    assert api.post(url + "captures/", evidence(5), format="json").status_code == 400


@pytest.mark.django_db
def test_start_idempotence_and_stop_reject_late_browser_upload(api, setup):
    base, app, request, session = setup
    url = base + f"apps/{app.pk}/social-research/"
    assert api.post(url, request, format="json").data["id"] == str(session.pk)
    request["topic"] = "Different query"
    assert api.post(url, request, format="json").status_code == 409
    session_url = collect(api, base, session)
    api.post(session_url, {"action": "stop"}, format="json")
    assert api.post(session_url + "captures/", evidence(7), format="json").status_code == 400
    assert api.post(session_url, {"action": "browse"}, format="json").status_code == 200
    assert api.post(session_url + "captures/", evidence(7), format="json").status_code == 200


@pytest.mark.django_db
def test_bad_review_and_duplicate_references_cannot_generate(api, setup):
    base, app, request, session = setup
    url = collect(api, base, session)
    result = api.post(url, {"action": "finish"}, format="json")

    def reject(*args, **kwargs):
        response = fake_analysis(*args, **kwargs)
        if args[1] == social_tasks.VERIFY_INSTRUCTION:
            response["result"] = {"supported": False, "reason": "Unsupported visual claim."}
        return response

    with patch.object(social_tasks, "call", side_effect=reject):
        social_tasks.research(result.data["workflow_id"])
    ids = list(map(str, session.posts.values_list("pk", flat=True)))[:3]
    response = api.post(
        url + "adapt/", {"request_id": str(uuid.uuid4()), "post_ids": ids}, format="json"
    )
    assert response.status_code == 400
    assert GenerationRun.objects.count() == 0


@pytest.mark.django_db
def test_evidence_images_are_private_validated_and_bounded(api, setup, owner):
    base, app, request, session = setup
    planned(session)
    url = base + f"social-research/{session.pk}/"
    api.post(url, {"action": "browse"}, format="json")
    image = io.BytesIO()
    Image.new("RGB", (32, 32), "blue").save(image, "JPEG")
    raw = evidence()
    raw["frames"] = [base64.b64encode(image.getvalue()).decode()]
    response = api.post(url + "captures/", raw, format="json")
    assert response.status_code == 200
    image_url = base + f"social-posts/{response.data['posts'][0]['id']}/frames/0/"
    response = api.get(image_url)
    assert response.status_code == 200
    assert response.content == image.getvalue()
    assert response["Cache-Control"] == "private, no-store"
    assert api.get(image_url.replace("/0/", "/1/")).status_code == 404
    other = Workspace.objects.create(name="Other image reader")
    assert api.get(image_url.replace(str(session.workspace_id), str(other.pk))).status_code == 404
    raw["url"] = "https://www.tiktok.com/@runner/video/2"
    raw["frames"] = ["not an image"]
    assert api.post(url + "captures/", raw, format="json").status_code == 400
    api.force_authenticate(None)
    assert api.get(image_url).status_code == 403


@pytest.mark.django_db
def test_retina_capture_is_saved_and_served_as_a_valid_private_jpeg(api, setup):
    base, _, _, session = setup
    planned(session)
    url = base + f"social-research/{session.pk}/"
    api.post(url, {"action": "browse"}, format="json")
    raw = evidence()
    raw["frames"] = [jpeg_frame()]
    response = api.post(url + "captures/", raw, format="json")
    assert response.status_code == 200, response.data
    post = session.posts.get()
    assert len(post.frames) == 1
    saved = api.get(base + f"social-posts/{post.pk}/frames/0/")
    assert saved.status_code == 200
    assert saved["Content-Type"] == "image/jpeg"
    assert saved["Cache-Control"] == "private, no-store"
    with Image.open(io.BytesIO(saved.content)) as image:
        image.load()
        assert image.size == (1200, 650)
    assert "resized" in post.evidence["coverage"]
    replay = api.post(url + "captures/", raw, format="json")
    assert replay.status_code == 200
    assert session.posts.count() == 1


@pytest.mark.parametrize("static_format", ["carousel", "image", "text"])
def test_analysis_cannot_relabel_a_video_as_static_to_bypass_missing_views(static_format):
    raw, _, _ = validate_capture(evidence())
    analysis = fake_analysis(None, social_tasks.ANALYZE_INSTRUCTION, {"post": raw}, None)["result"]
    analysis["format"] = static_format
    with pytest.raises(ProviderError, match="format contradicts"):
        social_tasks.validate_analysis(analysis, raw)


@pytest.mark.django_db
@pytest.mark.parametrize("static_format", ["carousel", "image", "text"])
def test_ineligible_metrics_skip_ai_but_static_without_views_is_analyzed(api, setup, static_format):
    base, app, request, session = setup
    planned(session)
    url = base + f"social-research/{session.pk}/"
    api.post(url, {"action": "browse"}, format="json")
    for number, fmt, views in [(1, "video", None), (2, "video", "100"), (3, static_format, None)]:
        raw = evidence(number, fmt, views=views or "25K")
        if views is None:
            del raw["metrics"]["views"]
        assert api.post(url + "captures/", raw, format="json").status_code == 200
    response = api.post(url, {"action": "finish"}, format="json")
    with patch.object(social_tasks, "call", side_effect=fake_analysis) as calls:
        social_tasks.research(response.data["workflow_id"])
    assert calls.call_count == 2
    result = api.get(url).data
    assert result["status"] == "completed"
    assert [post["qualification"]["status"] for post in result["posts"]] == [
        "unqualified",
        "unqualified",
        "qualified",
    ]
    assert "Views were not observed." in result["posts"][0]["qualification"]["reasons"]
