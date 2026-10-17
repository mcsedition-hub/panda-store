"""Observable checks for a small, synthetic benchmark; never a semantic quality score."""

import copy
import hashlib
import json
from importlib.resources import files

from panda_store.ai.providers import ProviderError

from .. import editorial, grounding
from ..rules import FIELDS, RULESET, audit, localized_metadata

RUBRIC = {
    "grounding": "Every feature, claim and justification is supported by the imported text. "
    "A verbatim citation alone does not establish this.",
    "usefulness": "The observation identifies a specific defect and the replacement addresses it. "
    "Generic praise, cosmetic churn and character counts are insufficient.",
    "restraint": "Good copy is left alone, missing evidence is acknowledged, and no search demand, "
    "rankings or download improvement is invented.",
    "language": "The full replacement is natural in the listing language and preserves the brand.",
    "qualifications": "Payment, privacy, account, support and feature limitations retain their "
    "meaning; optional features are not presented as universal.",
}


def fingerprint(value):
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def load_suite():
    suite = json.loads(files(__package__).joinpath("cases.json").read_text(encoding="utf-8"))
    ids = set()
    for case in suite["cases"]:
        if case["id"] in ids:
            raise ValueError("Duplicate evaluation case ID.")
        ids.add(case["id"])
        listing = localized_metadata({**case["listing"], "locale": case["locale"]}, case["locale"])
        expected = case["expected"]
        required, allowed = map(
            set, (expected["required_proposals"], expected["allowed_proposals"])
        )
        if not required <= allowed <= set(listing) or not set(expected["verdicts"]) <= set(FIELDS):
            raise ValueError("Invalid evaluation field expectations.")
        if any(
            not set(values) <= {"keep", "improve", "insufficient_evidence", "not_imported"}
            for values in expected["verdicts"].values()
        ):
            raise ValueError("Invalid expected verdict.")
    return suite


def manifest(suite):
    return {
        "suite_version": suite["version"],
        "suite_sha256": fingerprint(suite),
        "prompt_version": editorial.VERSION,
        "knowledge_version": editorial.KNOWLEDGE_VERSION,
        "prompt_sha256": fingerprint(
            {
                "instruction": editorial.INSTRUCTION,
                "schema": editorial.SCHEMA,
                "criteria": editorial.FIELD_CRITERIA,
                "knowledge": editorial.knowledge(),
            }
        ),
        "ruleset": RULESET,
        "max_output_tokens": editorial.MAX_OUTPUT_TOKENS,
        "grounding_version": grounding.VERSION,
        "grounding_sha256": fingerprint(
            {"instruction": grounding.INSTRUCTION, "schema": grounding.schema([{"id": "item"}])}
        ),
        "grounding_max_output_tokens": grounding.MAX_OUTPUT_TOKENS,
    }


def case_inputs(case, provider, model):
    return {
        "metadata": {**copy.deepcopy(case["listing"]), "locale": case["locale"]},
        "snapshot_id": f"synthetic:{case['id']}",
        "locale": case["locale"],
        "platform": "ios",
        "ruleset": RULESET,
        "ai": {
            "provider": provider,
            "model": model,
            "prompt_version": editorial.VERSION,
            "max_output_tokens": editorial.MAX_OUTPUT_TOKENS,
            "grounding_version": grounding.VERSION,
            "grounding_max_output_tokens": grounding.MAX_OUTPUT_TOKENS,
        },
        "knowledge": editorial.knowledge(),
        "knowledge_version": editorial.KNOWLEDGE_VERSION,
        "field_criteria": copy.deepcopy(editorial.FIELD_CRITERIA),
    }


def assess(case, inputs, output, grounding_output=None):
    """Check delivered content AND discarded output, so filtering cannot hide model errors."""
    checks = []

    def check(key, passed, detail):
        checks.append({"id": key, "passed": bool(passed), "detail": detail})

    try:
        report = editorial.validate(output, inputs, audit(inputs))
        if inputs["ai"].get("grounding_version"):
            report = grounding.apply(grounding_output, inputs, report)
    except (ProviderError, KeyError, TypeError, ValueError, AttributeError):
        check(
            "response_contract", False, "The production validator could not accept this response."
        )
        return {"checks": checks, "passed": False, "report": None}

    info = report["editorial"]
    if "grounding" in info:
        check(
            "supported_claims",
            not (
                info["grounding"]["withheld_observations"]
                or info["grounding"]["withheld_proposals"]
            ),
            "Observations and proposals must pass the separate evidence review. "
            "A model verdict is not independent product verification.",
        )
    listing = localized_metadata(inputs["metadata"], inputs["locale"])
    proposals = [item for item in report["checks"] if item["basis"] == "editorial_hypothesis"]
    actual_fields = {item["field"] for item in proposals}
    verdicts = {item["field"]: item["verdict"] for item in info["assessments"]}
    expected = case["expected"]
    check(
        "validated_reviews",
        info["reviewed_fields"] == len(listing),
        f"{info['reviewed_fields']} validated reviews for {len(listing)} imported fields.",
    )
    check(
        "no_discarded_proposals",
        info["rejected_proposals"] == 0,
        f"{info['rejected_proposals']} proposals were rejected by production validation.",
    )
    for field, allowed in expected["verdicts"].items():
        check(
            f"verdict:{field}",
            verdicts.get(field) in allowed,
            f"Expected {', '.join(allowed)}; received {verdicts.get(field)}.",
        )
    for field in expected["required_proposals"]:
        check(f"proposal:{field}", field in actual_fields, "A usable proposal is expected here.")
    check(
        "focused_changes",
        actual_fields <= set(expected["allowed_proposals"]),
        "Unexpected changes: "
        + (", ".join(sorted(actual_fields - set(expected["allowed_proposals"]))) or "none")
        + ". Review any concrete justification before accepting this benchmark label.",
    )
    # These lexical checks are case-specific regression alarms, not general truth detectors.
    replacements = "\n".join(item["replacement"] for item in proposals).casefold()
    for forbidden in expected["forbidden_replacements"]:
        check(
            f"excluded:{forbidden}",
            forbidden.casefold() not in replacements,
            "This unsupported or injected phrase must not appear in a replacement.",
        )
    for field, groups in expected.get("preserve_terms", {}).items():
        proposal = next((item for item in proposals if item["field"] == field), None)
        if not proposal:
            continue
        for index, alternatives in enumerate(groups):
            check(
                f"preserved:{field}:{index}",
                any(word.casefold() in proposal["replacement"].casefold() for word in alternatives),
                "Expected a term from: "
                + ", ".join(alternatives)
                + ". This is a lexical check; verify the meaning manually.",
            )
    return {"checks": checks, "passed": all(item["passed"] for item in checks), "report": report}


def summarize(rows):
    evaluated = [row for row in rows if row["status"] == "evaluated"]
    return {
        "attempts": len(rows),
        "evaluated": len(evaluated),
        "expectations_met": sum(row["assessment"]["passed"] for row in evaluated),
        "expectations_missed": sum(not row["assessment"]["passed"] for row in evaluated),
        "errors": sum(row["status"] == "error" for row in rows),
        "not_run": sum(row["status"] == "not_run" for row in rows),
        "unfinished": sum(row["status"] == "in_progress" for row in rows),
        "human_review": "pending",
    }
