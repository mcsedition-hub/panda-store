"""Conservative, local checks. Imported copy is data, never executable instructions.

Change RULESET and the workflow version when changing rule semantics. Reports keep
their own evidence and source references; older results are not recomputed on read.
"""

import json
import re
import unicodedata
from importlib.resources import files

RULESET = "apple-metadata-2026-10-16.1"
REVIEWED_ON = "2026-10-16"
FIELDS = ("name", "subtitle", "description", "keywords", "promotional_text")


def localized_metadata(metadata, locale):
    localizations = metadata.get("localizations")
    if localizations:
        matches = [item for item in localizations if item.get("locale") == locale]
        if len(matches) != 1:
            raise ValueError("Choose a language present in the imported listing.")
        text = matches[0]
    elif metadata.get("locale") == locale:
        text = metadata
    else:
        raise ValueError("Choose a language present in the imported listing.")
    available = text.get("available_fields", FIELDS)
    return {
        field: text[field]
        for field in FIELDS
        if field in available and isinstance(text.get(field), str)
    }


def source_catalog():
    data = json.loads(files("addons.aso").joinpath("knowledge/sources.json").read_text())
    return {
        source["id"]: {key: source[key] for key in ("id", "title", "publisher", "url")}
        | {"reviewed_on": REVIEWED_ON}
        for source in data["sources"]
    }


def normalize(value):
    return unicodedata.normalize("NFC", value).casefold()


def audit(inputs):
    if inputs["ruleset"] != RULESET or inputs["platform"] != "ios":
        raise ValueError("Unsupported audit ruleset or store.")
    text = localized_metadata(inputs["metadata"], inputs["locale"])
    sources = source_catalog()
    checks = []

    def add(key, field, title, status, basis, observation, action, refs, **extra):
        checks.append(
            {
                "id": key,
                "field": field,
                "title": title,
                "status": status,
                "basis": basis,
                "observation": observation,
                "action": action,
                "sources": [sources[ref] for ref in refs],
                **extra,
            }
        )

    for field, title, limit, required, ref in [
        ("name", "App name", 30, True, "apple-product-page"),
        ("subtitle", "Subtitle", 30, False, "apple-product-page"),
        ("description", "Description", 4000, True, "apple-version-information"),
        ("promotional_text", "Promotional text", 170, False, "apple-version-information"),
    ]:
        value = text.get(field)
        if value is None:
            status, observation, action = (
                "unavailable",
                "This field is not available in the imported language.",
                "Refresh the listing or check this language in App Store Connect.",
            )
        elif required and not value.strip():
            status, observation, action = (
                "issue",
                "The imported field is empty; Apple requires this field.",
                "Check the current listing and add accurate app information if it is empty.",
            )
        else:
            status = "issue" if len(value) > limit else "passed"
            observation = f"{len(value)} / {limit} characters."
            action = (
                f"Shorten this field by at least {len(value) - limit} characters."
                if status == "issue"
                else "Within the documented length limit. Content quality is not assessed here."
            )
            if not value and not required:
                action = "This field is optional and is currently empty."
        add(
            f"{field}.length",
            field,
            title,
            status,
            "requirement",
            observation,
            action,
            [ref],
            observed=value,
        )

    keywords = text.get("keywords")
    refs = ["apple-version-information", "apple-search"]
    if keywords is None:
        add(
            "keywords.length",
            "keywords",
            "Keyword budget",
            "unavailable",
            "requirement",
            "Keywords were not imported for this language.",
            "Refresh the listing or check this language in App Store Connect.",
            refs,
        )
    else:
        size, byte_size = len(keywords), len(keywords.encode("utf-8"))
        status = "passed"
        action = "Within both published limits. This does not assess keyword relevance."
        if not keywords.strip():
            status, action = "issue", "Check the listing: Apple's reference requires keywords."
        elif size > 100:
            status, action = (
                "issue",
                "Choose which terms to keep; both published limits are exceeded.",
            )
        elif byte_size > 100:
            status = "review"
            action = (
                "Check acceptance in App Store Connect before changing or submitting this field."
            )
        add(
            "keywords.length",
            "keywords",
            "Keyword budget",
            status,
            "requirement",
            f"{size} characters; {byte_size} UTF-8 bytes. Apple's reference says 100 bytes; "
            "its search guide says 100 characters.",
            action,
            refs,
            observed=keywords,
        )
        if keywords.strip():
            # Whole-word equality only: no stemming, translation or accent stripping.
            # Do not split phrases or guess localized category names.
            indexed = {}
            for field in ("name", "subtitle"):
                for word in re.findall(
                    r"[^\W_]+", normalize(text.get(field, "")), flags=re.UNICODE
                ):
                    indexed.setdefault(normalize(word), field)
            seen, keep, removed = set(), [], []
            tokens = keywords.split(",")
            for token in tokens:
                term = token.strip()
                normalized = normalize(term)
                if not term:
                    continue
                if normalized in seen:
                    removed.append({"term": term, "reason": "Repeated in keywords"})
                elif normalized in indexed:
                    removed.append({"term": term, "reason": f"Already in {indexed[normalized]}"})
                else:
                    keep.append(term)
                seen.add(normalized)
            candidate = ",".join(keep)
            spacing = any(token != token.strip() or not token.strip() for token in tokens)
            changed = bool(removed) or spacing
            # A proposed cleanup must itself fit both limits and retain useful content.
            replacement = (
                candidate if changed and candidate and len(candidate.encode()) <= 100 else None
            )
            add(
                "keywords.cleanup",
                "keywords",
                "Keyword repetition and separators",
                "recommendation" if changed else "passed",
                "recommendation",
                "; ".join(f"{item['term']}: {item['reason'].lower()}" for item in removed)
                + (". Extra separator spaces or empty entries found." if spacing else "")
                if changed
                else "No exact repeated terms or extra separator spaces found.",
                "Review the proposed cleanup. It only removes exact repetitions and separator "
                "spaces; it does not add keywords or predict traffic."
                if replacement
                else (
                    "Review redundant entries and select relevant terms before replacing keywords."
                    if changed
                    else "Phrases, plurals, category overlap and relevance still need review."
                ),
                ["apple-search"],
                observed=keywords,
                replacement=replacement,
                removed=removed,
            )
    metadata = inputs["metadata"]
    shots = metadata.get("screenshots", [])
    same_locale = metadata.get("screenshots_locale") == inputs["locale"]
    add(
        "screenshots.review",
        "screenshots",
        "Screenshot content",
        "review" if same_locale and shots else "unavailable",
        "recommendation",
        f"{len(shots)} screenshots imported for {inputs['locale']}."
        if same_locale and shots
        else "No screenshots were imported for this language.",
        "Review whether the images show the app's real experience and main benefit. "
        "Image content, device coverage and conversion are not checked by this audit.",
        ["apple-product-page"],
    )
    add(
        "content.review",
        "listing",
        "Relevance and claims",
        "review",
        "recommendation",
        "Length and exact repetition checks do not establish relevance or accuracy.",
        "Check that the copy describes existing features, matches this audience and avoids "
        "unauthorized brand names. Competitor and search-demand research are not connected.",
        ["apple-search"],
    )
    add(
        "performance.unavailable",
        "analytics",
        "Download impact",
        "unavailable",
        "measurement",
        "No store performance report or experiment is attached to this audit.",
        "Import performance data and define a measurement period before assessing changes. "
        "A metadata refresh only verifies the listing; it does not measure download impact.",
        ["apple-search"],
    )
    return {
        "ruleset": RULESET,
        "reviewed_on": REVIEWED_ON,
        "locale": inputs["locale"],
        "snapshot_id": inputs["snapshot_id"],
        "checks": checks,
        "counts": {
            status: sum(check["status"] == status for check in checks)
            for status in ("issue", "recommendation", "review", "unavailable", "passed")
        },
    }
