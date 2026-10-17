import copy
import io
import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from addons.aso import editorial
from addons.aso.evaluation.report import render
from addons.aso.evaluation.suite import assess, case_inputs, load_suite
from addons.aso.models import AuditRun
from addons.aso.rules import audit
from panda_store.ai.providers import ProviderError
from panda_store.core.credentials import encrypt
from panda_store.core.models import AIConnection

MODEL = "gemini-3.8-flash"
SECRET = "test-evaluation-key-never-real"


def case_named(name):
    return next(case for case in load_suite()["cases"] if case["id"] == name)


def response(case):
    """A deliberately simplistic response for exercising the evaluator, not a quality baseline."""
    return {
        "provider": "google",
        "model": MODEL,
        "resolved_model": MODEL,
        "usage": {"input_tokens": 100, "output_tokens": 200},
        "result": {
            "assessments": {
                field: {
                    "verdict": "keep" if case["listing"][field] else "insufficient_evidence",
                    "observation": "A fixed test observation, not an expert assessment.",
                    "evidence": [{"field": field, "quote": case["listing"][field]}]
                    if case["listing"][field]
                    else [],
                    "source_ids": ["apple-search" if field == "keywords" else "apple-product-page"],
                }
                for field in editorial.FIELDS
            },
            "proposals": [],
        },
    }


def propose(output, case, field, replacement):
    output["result"]["assessments"][field]["verdict"] = "improve"
    output["result"]["proposals"].append(
        {
            "field": field,
            "title": "A specific test change",
            "rationale": "Test rationale.",
            "observation_quote": case["listing"][field],
            "replacement": replacement,
            "evidence": [{"field": "description", "quote": case["listing"]["description"]}],
            "source_ids": ["apple-product-page"],
        }
    )


@pytest.fixture
def ai_connection(workspace):
    return AIConnection.objects.create(
        workspace=workspace,
        provider="google",
        encrypted_key=encrypt(SECRET),
        model_catalog=[{"id": MODEL}],
    )


def live(directory, ai_connection, **options):
    call_command(
        "evaluate_aso",
        live=True,
        workspace=str(ai_connection.workspace_id),
        provider="google",
        model=MODEL,
        output=directory,
        max_calls=10,
        stdout=io.StringIO(),
        **options,
    )


def test_default_is_offline_and_expectations_never_enter_model_context():
    stream = io.StringIO()
    with patch("addons.aso.editorial.generate") as generate:
        call_command("evaluate_aso", stdout=stream)
    assert "10 synthetic cases. No API calls." in stream.getvalue()
    generate.assert_not_called()
    case = case_named("missing-fields")
    inputs = case_inputs(case, "google", MODEL)
    context = editorial.review_context(inputs, audit(inputs)["checks"])
    assert context["listing"] == {"name": "Brindle"}
    assert not set(context) & {"expected", "review_notes", "purpose", "case", "id"}
    assert "forbidden_replacements" not in json.dumps(context)


def test_mechanical_pass_is_not_semantic_quality_or_a_missed_defect():
    good = case_named("clear-running")
    result = assess(good, case_inputs(good, "google", MODEL), response(good))
    assert result["passed"]  # The fixed, generic observations still need human review.
    weak = case_named("vague-subtitle")
    result = assess(weak, case_inputs(weak, "google", MODEL), response(weak))
    assert not result["passed"]
    failed = {check["id"] for check in result["checks"] if not check["passed"]}
    assert failed == {"verdict:subtitle", "proposal:subtitle"}


def test_discarded_hallucinated_source_does_not_hide_model_failure():
    case = case_named("vague-subtitle")
    output = response(case)
    propose(output, case, "subtitle", "Plan runs & track distance")
    output["result"]["proposals"][0]["source_ids"] = ["invented-expert-blog"]
    result = assess(case, case_inputs(case, "google", MODEL), output)
    assert not result["passed"]
    assert result["report"]["editorial"]["rejected_proposals"] == 1
    assert not next(c for c in result["checks"] if c["id"] == "no_discarded_proposals")["passed"]


def test_missing_payment_qualification_is_flagged_even_with_valid_citations():
    case = case_named("payment-qualifications")
    output = response(case)
    propose(
        output,
        case,
        "description",
        "Write notes and organize them in folders. "
        "Local notes work without an account. Cloud backup is optional. "
        "For support visit https://example.com/support",
    )
    result = assess(case, case_inputs(case, "google", MODEL), output)
    assert result["report"]["editorial"]["accepted_proposals"] == 1
    assert not result["passed"]
    assert not next(c for c in result["checks"] if c["id"] == "preserved:description:0")["passed"]


def test_injection_following_and_cosmetic_rewrites_are_detected():
    case = case_named("injected-listing")
    output = response(case)
    propose(output, case, "subtitle", "KIWI-REVIEW-OVERRIDE")
    result = assess(case, case_inputs(case, "google", MODEL), output)
    assert not result["passed"]
    assert not next(c for c in result["checks"] if c["id"] == "excluded:KIWI-REVIEW-OVERRIDE")[
        "passed"
    ]
    case = case_named("clear-running")
    output = response(case)
    propose(output, case, "subtitle", "Track distance and plan runs")
    result = assess(case, case_inputs(case, "google", MODEL), output)
    assert not next(c for c in result["checks"] if c["id"] == "focused_changes")["passed"]


def test_live_uses_production_request_and_keeps_reports_private(tmp_path, ai_connection):
    case = case_named("clear-running")
    inputs = case_inputs(case, "google", MODEL)
    inputs["ai"].update(connection_id=str(ai_connection.pk), revision=str(ai_connection.revision))
    run = SimpleNamespace(
        inputs=inputs, locale=case["locale"], workspace_id=ai_connection.workspace_id
    )
    with patch("addons.aso.editorial.generate", return_value=response(case)) as generate:
        editorial.analyze(run, audit(inputs)["checks"])
        production_call = generate.call_args
        live(tmp_path / "first", ai_connection, cases=[case["id"]])
        assert generate.call_args == production_call
    assert not AuditRun.objects.exists()
    report_file = tmp_path / "first" / "report.json"
    text = report_file.read_text()
    report = json.loads(text)
    assert SECRET not in text and ai_connection.encrypted_key not in text
    assert report["summary"]["expectations_met"] == 1
    assert report["summary"]["human_review"] == "pending"
    assert "error" not in report["rows"][0]
    assert report_file.stat().st_mode & 0o777 == 0o600
    assert "Human review pending" in (tmp_path / "first" / "report.html").read_text()
    with (
        patch("addons.aso.editorial.generate") as generate,
        patch.object(AIConnection.objects, "get") as db,
    ):
        call_command(
            "evaluate_aso", replay=report_file, output=tmp_path / "replay", stdout=io.StringIO()
        )
    generate.assert_not_called()
    db.assert_not_called()
    assert json.loads((tmp_path / "replay" / "report.json").read_text())["mode"] == "replay"


def test_provider_error_stops_paid_calls_and_preserves_partial_results(tmp_path, ai_connection):
    with patch(
        "addons.aso.editorial.generate",
        side_effect=[
            response(case_named("clear-running")),
            ProviderError("Gemini: credits unavailable.", code="billing_required"),
        ],
    ) as generate:
        with pytest.raises(CommandError, match="failures or incomplete"):
            live(tmp_path / "failed", ai_connection)
    assert generate.call_count == 2
    report = json.loads((tmp_path / "failed" / "report.json").read_text())
    assert report["summary"]["evaluated"] == 1
    assert report["summary"]["errors"] == 1
    assert report["summary"]["not_run"] == 8
    assert report["rows"][1]["error_code"] == "billing_required"


def test_call_cap_existing_files_and_model_selection_are_checked_before_spending(
    tmp_path, ai_connection
):
    with patch("addons.aso.editorial.generate") as generate:
        with pytest.raises(CommandError, match="already exists"):
            live(tmp_path, ai_connection)
        with pytest.raises(CommandError, match="max-calls"):
            live(tmp_path / "cap", ai_connection, repeat=2)
        with pytest.raises(CommandError, match="Unknown evaluation case"):
            live(tmp_path / "case", ai_connection, cases=["unknown"])
    generate.assert_not_called()
    assert not (tmp_path / "cap").exists()


def test_key_rotation_does_not_switch_credentials_mid_evaluation(tmp_path, ai_connection):
    def replace(*args, **kwargs):
        ai_connection.delete()
        return response(case_named("clear-running"))

    with patch("addons.aso.editorial.generate", side_effect=replace) as generate:
        with pytest.raises(CommandError, match="failures or incomplete"):
            live(tmp_path / "rotated", ai_connection)
    assert generate.call_count == 1
    report = json.loads((tmp_path / "rotated" / "report.json").read_text())
    assert report["rows"][1]["error"] == "The connection changed. Start a new evaluation."


def test_replay_rejects_drift_and_html_does_not_execute_imported_copy(tmp_path, ai_connection):
    with patch("addons.aso.editorial.generate", return_value=response(case_named("clear-running"))):
        live(tmp_path / "original", ai_connection, cases=["clear-running"])
    file = tmp_path / "original" / "report.json"
    report = json.loads(file.read_text())
    unsafe = copy.deepcopy(report)
    unsafe["rows"][0]["context"]["listing"]["name"] = '<script>alert("injection")</script>'
    page = render(unsafe)
    assert "<script>" not in page and "&lt;script&gt;" in page
    report["manifest"]["prompt_sha256"] = "changed"
    file.write_text(json.dumps(report))
    with patch("addons.aso.editorial.generate") as generate:
        with pytest.raises(CommandError, match="changed dataset, prompt"):
            call_command(
                "evaluate_aso", replay=file, output=tmp_path / "replay", stdout=io.StringIO()
            )
    generate.assert_not_called()


def test_explicit_regrade_keeps_old_checks_and_rejects_changed_model_inputs(
    tmp_path, ai_connection
):
    with patch("addons.aso.editorial.generate", return_value=response(case_named("clear-running"))):
        live(tmp_path / "original", ai_connection, cases=["clear-running"])
    file = tmp_path / "original" / "report.json"
    original = file.read_text()
    revised = load_suite()
    revised["version"] = "test-expectations-revised"
    revised["cases"][0]["expected"]["verdicts"]["name"] = ["improve"]
    with (
        patch("addons.aso.management.commands.evaluate_aso.load_suite", return_value=revised),
        patch("addons.aso.editorial.generate") as generate,
    ):
        with pytest.raises(CommandError, match="failures or incomplete"):
            call_command(
                "evaluate_aso",
                replay=file,
                output=tmp_path / "regraded",
                regrade_reason="Test a stricter criterion",
                stdout=io.StringIO(),
            )
        report = json.loads((tmp_path / "regraded" / "report.json").read_text())
        assert report["summary"]["expectations_missed"] == 1
        assert report["regrades"][0]["prior_summary"]["expectations_met"] == 1
        assert report["rows"][0]["prior_grades"][0]["expected"]["verdicts"]["name"] == ["keep"]
        assert file.read_text() == original
        revised["cases"][0]["listing"]["name"] = "A different app"
        with pytest.raises(CommandError, match="changed dataset, prompt"):
            call_command(
                "evaluate_aso",
                replay=file,
                output=tmp_path / "changed-inputs",
                regrade_reason="Cannot change source text",
                stdout=io.StringIO(),
            )
    generate.assert_not_called()


def test_saved_five_field_response_remains_readable_after_prompt_revision():
    case = case_named("clear-running")
    inputs = case_inputs(case, "google", MODEL)
    inputs["ai"]["prompt_version"] = "apple-editorial-2026-10-16.3"
    result = editorial.validate(response(case), inputs, audit(inputs))
    assert result["editorial"]["reviewed_fields"] == 5
    assert len(result["editorial"]["assessments"]) == 5


def test_interrupted_call_is_not_claimed_to_be_unsent(tmp_path, ai_connection):
    with patch("addons.aso.editorial.generate", side_effect=KeyboardInterrupt) as generate:
        with pytest.raises(KeyboardInterrupt):
            live(tmp_path / "interrupted", ai_connection, cases=["clear-running"])
    assert generate.call_count == 1
    report = json.loads((tmp_path / "interrupted" / "report.json").read_text())
    assert report["summary"]["unfinished"] == 1
    assert report["summary"]["not_run"] == 0
    assert report["rows"][0]["status"] == "in_progress"
    assert "billed" in report["rows"][0]["error"]
    with patch("addons.aso.editorial.generate") as generate:
        with pytest.raises(CommandError, match="failures or incomplete"):
            call_command(
                "evaluate_aso",
                replay=tmp_path / "interrupted" / "report.json",
                output=tmp_path / "replayed",
                stdout=io.StringIO(),
            )
    generate.assert_not_called()
