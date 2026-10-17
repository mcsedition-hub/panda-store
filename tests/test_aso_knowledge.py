import json
from datetime import date
from importlib.resources import files

import pytest
from rest_framework.test import APIClient

from addons.aso import editorial
from addons.aso.corpus import VERSION, knowledge
from addons.aso.rules import FIELDS
from panda_store.core.access import activate_modules, deactivate_module
from panda_store.core.models import Membership, Workspace


def test_curated_annotations_have_traceable_scope_and_separate_dates():
    sources = json.loads(files("addons.aso").joinpath("knowledge/sources.json").read_text())
    catalog = {item["id"]: item for item in sources["sources"]}
    data = json.loads(files("addons.aso").joinpath("knowledge/editorial.json").read_text())
    assert VERSION == data["version"]
    assert len({item["id"] for item in data["entries"]}) == len(data["entries"])
    for item in data["entries"]:
        source = catalog[item["id"]]
        assert set(item["stores"]) <= set(source["stores"])
        assert set(item["fields"]) <= set(FIELDS)
        assert item["guidance"] and item["limitations"]
        assert date.fromisoformat(item["reviewed_on"]) <= date.today()
        assert source["url"].startswith("https://")
    assert {item["source"]["publisher"] for item in knowledge()} == {
        "Apple",
        "Phiture",
        "AppTweak",
        "SplitMetrics",
        "Duolingo",
        "Spotify",
        "Tinder",
    }
    # A catalog entry alone does not make its advice eligible for generation.
    assert knowledge(platform="android") == []
    assert knowledge(platform="unsupported") == []
    assert knowledge(fields=[]) == []
    assert all(item["fields"] == ["keywords"] for item in knowledge(fields=["keywords"]))
    assert "splitmetrics-testing-framework" not in {
        item["id"] for item in knowledge(fields=["keywords"])
    }
    first = knowledge()
    first[0]["guidance"] = "mutated"
    assert knowledge()[0]["guidance"] != "mutated"


def test_public_examples_have_observed_context_and_cannot_be_used_as_rules_or_keywords():
    sources = {item["id"]: item for item in knowledge()}
    examples = [
        item for item in sources.values() if item["source"]["kind"] == "public_listing_observation"
    ]
    assert len(examples) == 3
    assert len({item["observation_context"]["domain"] for item in examples}) == 3
    for example in examples:
        assert example["fields"] == ["name", "subtitle", "description"]
        assert example["observation_context"]["storefront"] == "US"
        assert example["observation_context"]["language"] == "en"
        assert example["source"]["reviewed_on"] == example["reviewed_on"]
        with pytest.raises(ValueError):
            editorial.checked_sources([example["id"]], sources, "description", strict=True)
        for field in ("keywords", "promotional_text"):
            assert example["id"] not in {item["id"] for item in knowledge(fields=[field])}
            with pytest.raises(ValueError):
                editorial.checked_sources(
                    ["apple-product-page", example["id"]], sources, field, strict=True
                )
        # Attribution must retain the original observation scope, not just the link.
        saved = editorial.checked_sources(
            ["apple-product-page", example["id"]], sources, "description", strict=True
        )[-1]
        assert saved["observation_context"] == example["observation_context"]
        assert saved["guidance"] == example["guidance"]


def test_library_requires_workspace_membership_and_active_module(api, workspace):
    url = f"/api/workspaces/{workspace.pk}/aso/knowledge/"
    assert api.get(url).status_code == 403
    activate_modules(workspace, ["aso"])
    response = api.get(url)
    assert response.status_code == 200
    assert response.data == {"version": VERSION, "entries": knowledge()}
    Membership.objects.filter(workspace=workspace).update(role="viewer")
    assert api.get(url).status_code == 200
    other = Workspace.objects.create(name="Other")
    assert api.get(f"/api/workspaces/{other.pk}/aso/knowledge/").status_code == 404
    assert APIClient().get(url).status_code in {401, 403}
    assert api.post(url, {}).status_code == 405
    deactivate_module(workspace, "aso")
    assert api.get(url).status_code == 403
