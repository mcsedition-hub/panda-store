import json
from datetime import date
from importlib.resources import files

from rest_framework.test import APIClient

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
