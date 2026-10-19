"""Google Play contracts through audits, drafts, comparisons and saved evidence."""

import copy
import uuid
from unittest.mock import patch

import pytest
from jsonschema import validate

from addons.aso import editorial, grounding, project, visual
from addons.aso.models import AuditRun
from addons.aso.rules import GOOGLE_RULESET, audit, localized_metadata
from addons.aso.stores import GOOGLE_FIELDS
from addons.aso.tasks import audit_listing
from tests.aso_support import supported_review
from tests.test_ai import connection as ai_connection
from tests.test_ai import listing as apple_listing
from tests.test_ai import start
from tests.test_aso_visual import png

connection = ai_connection
listing = apple_listing


@pytest.fixture
def google_listing(listing):
    app, snapshot = listing
    app.platform = "android"
    app.save()
    snapshot.source = "google_play.api"
    snapshot.data = {
        "locale": "en-US",
        "name": "Panda Run",
        "short_description": "Your running companion",
        "description": "Plan runs and track your distance. Your data stays on your device.",
        "available_fields": list(GOOGLE_FIELDS),
    }
    snapshot.save()
    return app, snapshot


def google_inputs(metadata):
    return {
        "ruleset": GOOGLE_RULESET,
        "platform": "android",
        "locale": "en-US",
        "snapshot_id": "saved",
        "metadata": metadata,
    }


@pytest.mark.parametrize(
    "field,limit", [("name", 30), ("short_description", 80), ("description", 4000)]
)
def test_google_limits_unicode_and_no_apple_fields(field, limit):
    data = {
        "locale": "en-US",
        **{key: "Present" for key in GOOGLE_FIELDS},
        "subtitle": "Apple only",
        "keywords": "not a Google field",
    }
    data[field] = "é" * limit
    before = copy.deepcopy(data)
    result = audit(google_inputs(data))
    assert result["counts"]["issue"] == 0
    assert set(localized_metadata(data, "en-US", "android")) == set(GOOGLE_FIELDS)
    assert all(
        item["field"] not in {"subtitle", "keywords", "promotional_text"}
        for item in result["checks"]
    )
    assert all(ref["publisher"] == "Google" for item in result["checks"] for ref in item["sources"])
    assert data == before
    for value, status in [("é" * (limit + 1), "issue"), ("", "issue"), (None, "unavailable")]:
        data[field] = value
        found = next(
            item for item in audit(google_inputs(data))["checks"] if item["field"] == field
        )
        assert found["status"] == status


def writing(ctx):
    data = ctx["listing"]
    return {
        "result": {
            "assessments": {
                field: {
                    "verdict": "improve" if field == "short_description" else "keep",
                    "observation": "Use the documented running actions."
                    if field == "short_description"
                    else "The text describes the app.",
                    "evidence": [{"field": field, "quote": data[field]}],
                    "source_ids": ["google-store-listing"],
                }
                for field in GOOGLE_FIELDS
            },
            "proposals": [
                {
                    "field": "short_description",
                    "title": "Describe the running actions",
                    "observation_quote": data["short_description"],
                    "rationale": "The description documents planning runs and tracking distance.",
                    "replacement": "Plan runs and track your distance.",
                    "evidence": [
                        {"field": "description", "quote": "Plan runs and track your distance."}
                    ],
                    "source_ids": ["google-store-listing"],
                }
            ],
        },
        "provider": "openai",
        "model": "gpt-4.1-mini",
        "resolved_model": "gpt-4.1-mini",
        "usage": {"input_tokens": 10, "output_tokens": 20},
    }


def respond(_provider, _key, _model, instruction, ctx, schema, **_kwargs):
    if "candidates" in ctx:
        return supported_review(ctx)
    assert instruction == editorial.GOOGLE_INSTRUCTION
    assert set(ctx["listing"]) == set(ctx["field_criteria"]) == set(GOOGLE_FIELDS)
    assert all("google_play" in item["stores"] for item in ctx["guidance"])
    result = writing(ctx)
    validate(result["result"], schema)
    return result


def finish(api, workspace, listing):
    response, payload = start(api, workspace, listing)
    assert response.status_code == 202, response.data
    run = AuditRun.objects.get(pk=response.data["id"])
    with patch.object(editorial, "generate", side_effect=respond) as calls:
        audit_listing(str(run.workflow_id))
    run.refresh_from_db()
    assert run.workflow.status == "succeeded", run.workflow.error
    assert calls.call_count == 2
    assert run.report["editorial"]["reviewed_fields"] == 3
    assert run.report["editorial"]["accepted_proposals"] == 1
    assert response.data["platform"] == "android"
    return run, payload


def test_google_audit_comparison_draft_validation_export_and_history(
    api, workspace, google_listing, connection
):
    app, snapshot = google_listing
    run, payload = finish(api, workspace, google_listing)
    base = f"/api/workspaces/{workspace.pk}/aso/"
    assert api.post(f"{base}apps/{app.pk}/runs/", payload, format="json").status_code == 200
    other, _ = finish(api, workspace, google_listing)
    check = next(item for item in other.report["checks"] if item.get("replacement"))
    response = api.post(
        f"{base}apps/{app.pk}/drafts/",
        {
            "request_id": str(uuid.uuid4()),
            "name": "Google comparison",
            "comparison": {
                "base_audit_id": str(run.pk),
                "selections": [
                    {
                        "field": "short_description",
                        "audit_id": str(other.pk),
                        "check_id": check["id"],
                    }
                ],
            },
        },
        format="json",
    )
    assert response.status_code == 201, response.data
    draft = response.data
    assert draft["platform"] == "android"
    assert set(draft["content"]) == set(GOOGLE_FIELDS)
    assert draft["content"]["short_description"] == check["replacement"]
    assert draft["validation"]["can_mark_ready"]
    assert draft["provenance"][0]["audit_id"] == str(other.pk)
    url = f"{base}drafts/{draft['id']}/"
    for field in ("subtitle", "keywords", "promotional_text"):
        denied = api.patch(
            url,
            {"request_id": str(uuid.uuid4()), "version": 1, "content": {field: "Apple field"}},
            format="json",
        )
        assert denied.status_code == 400
    overflow = api.patch(
        url,
        {"request_id": str(uuid.uuid4()), "version": 1, "content": {"short_description": "x" * 81}},
        format="json",
    )
    assert not overflow.data["validation"]["can_mark_ready"]
    blocked = api.patch(
        url, {"request_id": str(uuid.uuid4()), "version": 2, "status": "ready"}, format="json"
    )
    assert blocked.status_code == 400
    restored = api.patch(
        url, {"request_id": str(uuid.uuid4()), "version": 2, "restore_version": 1}, format="json"
    )
    assert restored.data["content"]["short_description"] == check["replacement"]
    exported = api.get(url + "export/?version=3").content.decode()
    assert "Google Play" in exported and "Short description" in exported
    assert "App Store" not in exported and "Keywords" not in exported
    snapshot.refresh_from_db()
    assert snapshot.data["short_description"] == "Your running companion"
    library = api.get(base + "knowledge/?platform=android").data
    assert library["entries"] and all(
        item["source"]["publisher"] == "Google" for item in library["entries"]
    )


def test_google_validator_rejects_apple_sources_and_unsupported_claims(
    api, workspace, google_listing, connection
):
    run, _ = finish(api, workspace, google_listing)
    ctx = editorial.review_context(run.inputs, [])
    original = writing(ctx)
    for change in ("apple", "overflow", "invented"):
        candidate = copy.deepcopy(original)
        proposal = candidate["result"]["proposals"][0]
        if change == "apple":
            proposal["source_ids"] = ["apple-product-page"]
        elif change == "overflow":
            proposal["replacement"] = "x" * 81
        else:
            proposal["replacement"] = "Track 999 runs."
        result = editorial.validate(candidate, run.inputs, audit(run.inputs))
        assert result["editorial"]["accepted_proposals"] == 0
    before = editorial.validate(original, run.inputs, audit(run.inputs))
    review = supported_review(grounding.context(run.inputs, before))
    row = next(item for item in review["result"]["reviews"] if item["id"].startswith("editorial."))
    row.update(verdict="unsupported", reason="Synthetic rejection.", unsupported_quote="Plan runs")
    result = grounding.apply(review, run.inputs, before)
    assert result["editorial"]["accepted_proposals"] == 0


def test_google_idea_generates_exactly_three_fields_and_requires_all_for_draft(
    api, workspace, google_listing, connection
):
    app, snapshot = google_listing
    app.origin = "project"
    app.save()
    snapshot.source = "project.manual"
    snapshot.data = {
        "locale": "en-US",
        "name": "Panda Run",
        "description": "",
        "project": {
            "origin": "project",
            "stage": "idea",
            "name": "Panda Run",
            "audience": "Runners",
            "specification": "Plan runs and track distance.",
            "available_features": "",
        },
    }
    snapshot.save()
    response, _ = start(api, workspace, google_listing, mode="project")
    assert response.status_code == 202, response.data
    run = AuditRun.objects.get(pk=response.data["id"])

    def answer(_p, _k, _m, instruction, ctx, schema, **_kw):
        if "proposal" in ctx:
            result = {
                "reviews": [
                    {"id": field, "supported": True, "reason": "Supported by the idea."}
                    for field in ("analysis", *GOOGLE_FIELDS)
                ]
            }
        else:
            assert instruction == project.GOOGLE_INSTRUCTION
            assert set(ctx["field_requirements"]) == set(GOOGLE_FIELDS)
            result = {
                "analysis": {
                    "positioning": "Running plans",
                    "audience": "Runners",
                    "search_intents": ["run planning"],
                    "missing_information": [],
                },
                "listing": {
                    field: {
                        "text": "Panda Run" if field == "name" else "Plan runs and track distance.",
                        "rationale": "Describe the planned functions.",
                        "source_ids": ["google-store-listing"],
                        "evidence": [
                            {"field": "specification", "quote": "Plan runs and track distance."}
                        ],
                    }
                    for field in GOOGLE_FIELDS
                },
            }
        validate(result, schema)
        return {"result": result, "usage": {}, "resolved_model": "gpt-4.1-mini"}

    with patch.object(editorial, "generate", side_effect=answer):
        audit_listing(str(run.workflow_id))
    run.refresh_from_db()
    assert run.workflow.status == "succeeded", run.workflow.error
    assert run.report["project"]["accepted"]
    assert len(run.report["project"]["fields"]) == 3
    result = api.post(
        f"/api/workspaces/{workspace.pk}/aso/apps/{app.pk}/drafts/",
        {
            "request_id": str(uuid.uuid4()),
            "name": "First Play listing",
            "audit_id": str(run.pk),
            "check_id": "project.listing",
        },
        format="json",
    )
    assert result.status_code == 201, result.data
    assert set(result.data["content"]) == set(GOOGLE_FIELDS)
    assert result.data["validation"]["can_mark_ready"]


def test_google_screenshots_use_google_guidance_and_archive_evidence(
    api, workspace, google_listing, connection
):
    app, snapshot = google_listing
    snapshot.data.update(
        screenshots_locale="en-US",
        screenshots=[
            {
                "url": "https://play-lh.googleusercontent.com/screenshot",
                "name": "run.webp",
                "display_type": "phoneScreenshots",
            }
        ],
    )
    snapshot.save()
    response, _ = start(api, workspace, google_listing, mode="screenshots")
    assert response.status_code == 202, response.data
    run = AuditRun.objects.get(pk=response.data["id"])
    assert all(note["source"]["publisher"] != "Apple" for note in run.inputs["knowledge"])

    def answer(_p, _k, _m, instruction, ctx, schema, **_kw):
        if "candidates" in ctx:
            assert instruction == visual.google_review_instruction()
            result = {
                "reviews": [
                    {"image_id": "shot-1", "verdict": "supported", "reason": "Synthetic support."}
                ]
            }
        else:
            assert instruction == visual.google_instruction()
            assert "short_description" in ctx["listing"] and "subtitle" not in ctx["listing"]
            result = {
                "assessments": [
                    {
                        "image_id": "shot-1",
                        "verdict": "improve",
                        "observation": "Synthetic observation",
                        "visible_text": "",
                        "recommendation": "Synthetic suggestion",
                        "source_ids": ["google-preview-assets"],
                    }
                ]
            }
        validate(result, schema)
        return {
            "result": result,
            "provider": "openai",
            "model": "gpt-4.1-mini",
            "resolved_model": "gpt-4.1-mini",
            "usage": {},
        }

    with (
        patch("addons.aso.images.download_batch", return_value=[(png(), "")]),
        patch.object(editorial, "generate", side_effect=answer),
    ):
        audit_listing(str(run.workflow_id))
    run.refresh_from_db()
    assert run.workflow.status == "succeeded", run.workflow.error
    assert run.report["visual"]["platform"] == "android"
    assert run.report["visual"]["images"][0]["sources"][0]["publisher"] == "Google"
    result = api.post(
        f"/api/workspaces/{workspace.pk}/aso/apps/{app.pk}/screenshot-briefs/",
        {
            "request_id": str(uuid.uuid4()),
            "audit_id": str(run.pk),
            "image_id": "shot-1",
            "name": "Google screenshot",
        },
        format="json",
    )
    assert result.status_code == 201, result.data
    assert set(result.data["source"]["listing"]) == set(GOOGLE_FIELDS)
