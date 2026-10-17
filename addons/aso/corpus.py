"""Reviewed annotations only. The broader source catalog is not an ingestion queue."""

import json
from importlib.resources import files

from .rules import FIELDS


def _read(name):
    return json.loads(files("addons.aso").joinpath(f"knowledge/{name}.json").read_text("utf-8"))


VERSION = _read("editorial")["version"]


def knowledge(platform="ios", fields=FIELDS):
    """Return fresh, store-scoped annotations suitable for freezing with an audit."""
    store = {"ios": "app_store", "android": "google_play"}.get(platform)
    catalog = {source["id"]: source for source in _read("sources")["sources"]}
    selected = []
    for entry in _read("editorial")["entries"]:
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
