import copy
import io
import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from addons.aso import editorial, grounding
from addons.aso.evaluation.suite import case_inputs, load_suite
from addons.aso.rules import audit
from panda_store.ai.providers import ProviderError
from panda_store.core.credentials import encrypt
from panda_store.core.models import AIConnection
from tests.aso_support import supported_review
from tests.test_aso_evaluation import propose, response


def sample():
    case = next(item for item in load_suite()["cases"] if item["id"] == "payment-qualifications")
    inputs = case_inputs(case, "google", "gemini-3.8-flash")
    output = response(case)
    propose(output, case, "description", case["listing"]["description"].split("\n\n")[1])
    report = editorial.validate(output, inputs, audit(inputs))
    return inputs, report


def reject(checked, key, quote, verdict="unsupported"):
    item = next(item for item in checked["result"]["reviews"] if item["id"] == key)
    item.update(
        verdict=verdict, reason="This claim exceeds the imported evidence.", unsupported_quote=quote
    )


@pytest.mark.parametrize("verdict", ["unsupported", "uncertain"])
def test_unjustified_rationale_blocks_the_proposal_even_with_valid_sources(verdict):
    inputs, report = sample()
    candidate = report["checks"][-1]
    candidate["observation"] = "This explains the core offline note-taking capability."
    saved = copy.deepcopy(report)
    checked = supported_review(grounding.context(inputs, report))
    reject(checked, candidate["id"], "offline note-taking capability", verdict)
    result = grounding.apply(checked, inputs, report)
    assert report == saved
    assert candidate["id"] not in {item["id"] for item in result["checks"]}
    assert "offline note-taking capability" not in str(result)
    assert result["editorial"]["rejected_proposals"] == 1
    assert result["editorial"]["accepted_proposals"] == 0
    assert result["counts"]["recommendation"] == report["counts"]["recommendation"] - 1
    assert result["editorial"]["grounding"]["withheld_proposals"] == 1


def test_unjustified_observation_also_blocks_its_otherwise_supported_proposal():
    inputs, report = sample()
    item = next(
        item for item in report["editorial"]["assessments"] if item["field"] == "description"
    )
    item["observation"] = "The description preserves verified product features."
    checked = supported_review(grounding.context(inputs, report))
    reject(checked, "assessment.description", "verified product features")
    result = grounding.apply(checked, inputs, report)
    assert result["editorial"]["reviewed_fields"] == 4
    assert result["editorial"]["accepted_proposals"] == 0
    assert result["editorial"]["grounding"]["withheld_observations"] == 1
    assert "verified product features" not in str(result)
    blocked = next(
        item for item in result["editorial"]["assessments"] if item["field"] == "description"
    )
    assert blocked["verdict"] == "unvalidated"
    assert blocked["sources"] == [] and blocked["evidence"] == []


@pytest.mark.parametrize(
    "flaw",
    ["missing", "duplicate", "unknown", "quote", "version", "context", "empty", "supported_quote"],
)
def test_incomplete_or_unbound_review_never_publishes_candidates(flaw):
    inputs, report = sample()
    checked = supported_review(grounding.context(inputs, report))
    if flaw == "missing":
        checked["result"]["reviews"].pop()
    elif flaw == "duplicate":
        checked["result"]["reviews"][-1] = checked["result"]["reviews"][0]
    elif flaw == "unknown":
        checked["result"]["reviews"][0]["id"] = "invented"
    elif flaw == "quote":
        reject(checked, "assessment.name", "not actually in this observation")
    elif flaw == "version":
        checked["version"] = "old"
    elif flaw == "context":
        report["checks"][-1]["replacement"] = "Changed after review"
    elif flaw == "empty":
        checked = None
    else:
        checked["result"]["reviews"][0]["unsupported_quote"] = "contradiction"
    with pytest.raises(ProviderError, match="No unchecked recommendations"):
        grounding.apply(checked, inputs, report)


def test_review_checks_every_generated_text_and_cannot_resurrect_structural_failures():
    inputs, report = sample()
    report["editorial"]["assessments"][0]["verdict"] = "unvalidated"
    report["editorial"]["rejected_proposals"] = 2
    data = grounding.context(inputs, report)
    assert "assessment.name" not in {item["id"] for item in data["candidates"]}
    proposal = next(item for item in data["candidates"] if item["id"].startswith("editorial."))
    assert set(proposal["content"]) == {"title", "rationale", "replacement"}
    result = grounding.apply(supported_review(data), inputs, report)
    assert result["editorial"]["assessments"][0]["verdict"] == "unvalidated"
    assert result["editorial"]["rejected_proposals"] == 2


def test_no_provider_call_when_nothing_passed_structural_validation():
    inputs, report = sample()
    report["checks"] = [
        item for item in report["checks"] if item["basis"] != "editorial_hypothesis"
    ]
    for item in report["editorial"]["assessments"]:
        item["verdict"] = "unvalidated"
    with patch("addons.aso.editorial.call") as call:
        checked = grounding.review(SimpleNamespace(inputs=inputs), report)
    call.assert_not_called()
    result = grounding.apply(checked, inputs, report)
    assert result["editorial"]["grounding"]["reviewed_items"] == 0
    assert result["editorial"]["grounding"]["usage"] == {}


def test_reviewer_sees_rule_findings_but_never_uses_generated_claims_as_evidence():
    case = next(item for item in load_suite()["cases"] if item["id"] == "deterministic-duplicates")
    inputs = case_inputs(case, "google", "gemini-3.8-flash")
    checks = audit(inputs)
    report = editorial.validate(response(case), inputs, checks)
    data = grounding.context(inputs, report)
    assert (
        data["existing_findings"]
        == editorial.review_context(inputs, checks["checks"])["existing_findings"]
    )
    assert data["existing_findings"][0]["replacement"] == "fitness,training"
    _, generated = sample()
    report["checks"].append(generated["checks"][-1])
    assert grounding.context(inputs, report)["existing_findings"] == data["existing_findings"]


def test_calibration_is_offline_by_default_and_checks_budget_before_calling(tmp_path, workspace):
    connection = AIConnection.objects.create(
        workspace=workspace,
        provider="google",
        encrypted_key=encrypt("test-only-secret"),
        model_catalog=[{"id": "gemini-3.8-flash"}],
    )
    options = dict(
        live=True,
        workspace=str(workspace.pk),
        provider="google",
        model="gemini-3.8-flash",
        output=tmp_path / "result",
        stdout=io.StringIO(),
    )
    with patch("addons.aso.editorial.generate") as generate:
        call_command("evaluate_aso_grounding", stdout=io.StringIO())
        with pytest.raises(CommandError, match="max-calls"):
            call_command("evaluate_aso_grounding", **options, max_calls=6)
        assert not options["output"].exists()
        connection.delete()
        with pytest.raises(CommandError, match="Connect this provider"):
            call_command("evaluate_aso_grounding", **options, max_calls=7)
    generate.assert_not_called()


def test_calibration_stops_after_provider_error_and_preserves_earlier_response(tmp_path, workspace):
    secret = "test-only-calibration-secret"
    connection = AIConnection.objects.create(
        workspace=workspace,
        provider="google",
        encrypted_key=encrypt(secret),
        model_catalog=[{"id": "gemini-3.8-flash"}],
    )
    count = 0

    def respond(*args, **kwargs):
        nonlocal count
        count += 1
        if count > 1:
            raise ProviderError("Provider quota reached.")
        return supported_review(args[4])

    with patch("addons.aso.editorial.generate", side_effect=respond):
        with pytest.raises(CommandError, match="expectations missed"):
            call_command(
                "evaluate_aso_grounding",
                live=True,
                workspace=str(workspace.pk),
                provider="google",
                model="gemini-3.8-flash",
                max_calls=7,
                output=tmp_path / "result",
                stdout=io.StringIO(),
            )
    path = tmp_path / "result" / "report.json"
    contents = path.read_text()
    data = json.loads(contents)
    assert count == 2 and data["rows"][0]["status"] == "evaluated"
    assert data["rows"][0]["passed"] is False  # An overly permissive grader must fail this case.
    assert data["rows"][1]["status"] == "error"
    assert all(row["status"] == "not_run" for row in data["rows"][2:])
    assert secret not in contents and connection.encrypted_key not in contents
    assert path.stat().st_mode & 0o777 == 0o600
    assert not any("expected" in row["context"] for row in data["rows"] if "context" in row)
