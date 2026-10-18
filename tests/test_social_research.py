import copy
import uuid
from unittest.mock import patch

import pytest
from rest_framework.exceptions import ValidationError

from addons.app_catalog.models import MobileApp
from addons.studio import creative_ai, social_tasks
from addons.studio.creative_tasks import generate_ai_scripts
from addons.studio.models import GenerationRun, SocialPost, SocialResearch
from addons.studio.social_evidence import count, post_url, qualify, validate_capture
from panda_store.ai.providers import ProviderError
from panda_store.core.credentials import encrypt
from panda_store.core.models import AIConnection, Membership, Workspace


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
    assert social_tasks.validate_plan(output, ["google"])["queries"][0]["query"].startswith("site:")


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


def test_qualification_requires_real_counters_and_distinguishes_formats():
    raw = evidence()
    raw["metrics"]["views"]["quote"] = "invented 25K views"
    clean, metrics, _ = validate_capture(raw)
    assert "views" not in metrics
    assert (
        qualify(clean, metrics, {"min_views": 10000, "min_likes": 500})["status"] == "unqualified"
    )
    assert (
        qualify(clean, metrics, {"min_views": 10000, "min_likes": 500}, content_format="carousel")[
            "status"
        ]
        == "metrics_pass"
    )
    clean["blocked_reason"] = "Sign in"
    assert (
        qualify(clean, metrics, {"min_views": 10000, "min_likes": 500}, content_format="carousel")[
            "status"
        ]
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


def collect(api, base, session):
    planned(session)
    url = base + f"social-research/{session.pk}/"
    assert api.post(url, {"action": "browse"}, format="json").status_code == 200
    for n, fmt in [(1, "video"), (2, "carousel"), (3, "video"), (4, "video")]:
        response = api.post(
            url + "captures/", evidence(n, fmt, likes="20" if n == 4 else "2K"), format="json"
        )
        assert response.status_code == 200, response.data
    return url


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
def test_adapt_reuses_compatible_research_with_frozen_provenance(api, split_research):
    base, source, target, posts = split_research
    url = base + f"social-research/{target.pk}/"
    library = api.get(url + "references/")
    assert library.status_code == 200
    assert {p["id"] for p in library.data["posts"]} == {str(p.pk) for p in posts[1:]}
    assert {p["research_id"] for p in library.data["posts"]} == {str(source.pk)}
    ordered = [posts[1], posts[0], posts[2]]
    body = {"request_id": str(uuid.uuid4()), "post_ids": [str(p.pk) for p in ordered]}
    response = api.post(url + "adapt/", body, format="json")
    assert response.status_code == 202, response.data
    sources = response.data["context"]["sources"]
    assert [s["page_id"] for s in sources] == body["post_ids"]
    assert [s["research_id"] for s in sources] == [str(p.research_id) for p in ordered]
    assert [s["format"] for s in sources] == ["carousel", "video", "video"]
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
    assert "corrections" not in model_context["sources"][0]["finding"]
    assert "unsupported promise" not in str(model_context)
    assert run.inputs == frozen


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
def test_end_to_end_distinct_sources_and_formats(api, setup):
    base, app, request, session = setup
    url = collect(api, base, session)
    response = api.post(url, {"action": "finish"}, format="json")
    with patch.object(social_tasks, "call", side_effect=fake_analysis) as calls:
        social_tasks.research(response.data["workflow_id"])
    assert calls.call_count == 6  # Low-like post is never sent to the model.
    result = api.get(url).data
    assert result["status"] == "completed"
    qualified = [p for p in result["posts"] if p["qualification"]["status"] == "qualified"]
    assert len(qualified) == 3
    body = {"request_id": str(uuid.uuid4()), "post_ids": [p["id"] for p in qualified]}
    response = api.post(url + "adapt/", body, format="json")
    assert response.data["context"]["mode"] == "smm"
    assert response.status_code == 202, response.data
    again = api.post(url + "adapt/", body, format="json")
    assert again.data["id"] == response.data["id"]
    run = GenerationRun.objects.get(pk=response.data["id"])
    assert run.inputs["mode"] == "smm"
    assert [s["format"] for s in run.inputs["sources"]] == ["video", "carousel", "video"]
    scripts = [
        {
            "variant": i + 1,
            "angle": f"Angle {i}",
            "hook": f"Question {i}?",
            "script": [
                "Film a runner checking a map.",
                "Slide 1: Your first step. Slide 2: A route.",
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
    wrong[1]["content_format"] = "video"
    with pytest.raises(ProviderError):
        creative_ai.validate_scripts({"result": {"scripts": wrong}}, run.inputs)
    wrong = copy.deepcopy(scripts)
    wrong[2]["source_page_ids"] = wrong[0]["source_page_ids"]
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
                        {"variant": i, "supported": True, "reason": "Supported"} for i in [1, 2, 3]
                    ]
                }
            },
        ],
    ):
        generate_ai_scripts(str(run.pk))
    run.refresh_from_db()
    assert run.workflow.status == "succeeded"
    assert run.creatives.get(variant=2).provenance["content_format"] == "carousel"
    export = api.get(base + f"runs/{run.pk}/export/")
    assert export.status_code == 200
    text = export.content.decode()
    for source in run.inputs["sources"]:
        assert source["url"] in text
        assert source["research_id"] in text
        assert source["coverage"] in text
    assert "Format: carousel" in text
    assert "Observed views: ≈ 25,000 (label: 25K)" in text
    assert "Observed comments: Not observed" in text
    assert "Audio and complete sequence were not observed." in text
    assert "video only; not applicable to carousel or text" in text
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
    import base64
    import io

    from PIL import Image

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


def test_analysis_cannot_relabel_a_video_as_a_carousel_to_bypass_missing_views():
    raw, _, _ = validate_capture(evidence())
    analysis = fake_analysis(None, social_tasks.ANALYZE_INSTRUCTION, {"post": raw}, None)["result"]
    analysis["format"] = "carousel"
    with pytest.raises(ProviderError, match="format contradicts"):
        social_tasks.validate_analysis(analysis, raw)


@pytest.mark.django_db
def test_ineligible_metrics_skip_ai_but_carousel_without_views_is_analyzed(api, setup):
    base, app, request, session = setup
    planned(session)
    url = base + f"social-research/{session.pk}/"
    api.post(url, {"action": "browse"}, format="json")
    for number, fmt, views in [(1, "video", None), (2, "video", "100"), (3, "carousel", None)]:
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
