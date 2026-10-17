from dataclasses import replace

import pytest
from django.core.exceptions import ImproperlyConfigured

from panda_store.core.registry import Module, ModuleRegistry, get_registry


def test_bundled_registry_orders_dependencies():
    registry = get_registry()
    assert registry.resolve(["studio"]) == ("app_catalog", "studio")
    assert registry.modules["example"].package == "addons.example"


@pytest.mark.parametrize("problem", ["duplicate", "missing", "version", "core", "cycle"])
def test_invalid_graph_fails_at_startup(problem):
    catalog = get_registry().modules["app_catalog"]
    studio = get_registry().modules["studio"]
    modules = [catalog, studio]
    if problem == "duplicate":
        modules.append(catalog)
    elif problem == "missing":
        modules = [studio]
    elif problem == "version":
        modules[1] = replace(studio, depends={"app_catalog": ">=99"})
    elif problem == "core":
        modules[1] = replace(studio, core=">=99")
    else:
        modules[0] = replace(catalog, depends={"studio": ">=0.1.0"})
    with pytest.raises(ImproperlyConfigured):
        ModuleRegistry(iter(modules), "0.1.0")


@pytest.mark.parametrize(
    "field,value",
    [
        ("id", "../evil"),
        ("required", "false"),
        ("capabilities", [123]),
        ("icon", "../logo"),
        ("depends", []),
        ("name", ""),
        ("availability", "unknown"),
    ],
)
def test_manifest_rejects_invalid_types_and_paths(field, value):
    manifest = {
        "id": "sample",
        "name": "Sample",
        "version": "0.1.0",
        "core": ">=0.1,<0.2",
        "family": "lichen",
        "description": "A sample",
        field: value,
    }
    with pytest.raises(ImproperlyConfigured):
        Module.parse(manifest, "addons.sample")


def test_planned_module_cannot_be_required():
    from dataclasses import asdict

    manifest = {**asdict(get_registry().modules["aso"]), "required": True}
    manifest["capabilities"] = []
    with pytest.raises(ImproperlyConfigured, match="required module must be available"):
        Module.parse(manifest, "addons.aso")
