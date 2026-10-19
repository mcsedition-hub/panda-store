"""Reviewed annotations only. The broader source catalog is not an ingestion queue."""

import json
from importlib.resources import files

from .stores import fields_for


def _read(name):
    return json.loads(files("addons.aso").joinpath(f"knowledge/{name}.json").read_text("utf-8"))


VERSION = _read("editorial")["version"]
GOOGLE_VERSION = _read("google-editorial")["version"]


def version_for(platform="ios"):
    return GOOGLE_VERSION if platform == "android" else VERSION


def knowledge(platform="ios", fields=None):
    """Return fresh, store-scoped annotations suitable for freezing with an audit."""
    store = {"ios": "app_store", "android": "google_play"}.get(platform)
    fields = fields if fields is not None else fields_for(platform)
    catalog = {source["id"]: source for source in _read("sources")["sources"]}
    selected = []
    for entry in _read("google-editorial" if platform == "android" else "editorial")["entries"]:
        source = catalog[entry["id"]]
        if store not in entry["stores"] or store not in source["stores"]:
            continue
        applicable = [field for field in entry["fields"] if field in fields]
        if not applicable:
            continue
        selected.append(
            {
                **entry,
                "fields": applicable,
                "source": {key: source[key] for key in ("id", "title", "publisher", "url", "kind")}
                | {"reviewed_on": entry["reviewed_on"]},
            }
        )
    return selected
