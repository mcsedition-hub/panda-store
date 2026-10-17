"""Explicit, bounded live evaluation or free replay of saved responses."""

import copy
import json
import time
from datetime import UTC, datetime
from pathlib import Path

from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.core.serializers.json import DjangoJSONEncoder

from addons.aso import editorial
from addons.aso.evaluation.report import render
from addons.aso.evaluation.suite import assess, case_inputs, load_suite, manifest, summarize
from addons.aso.rules import audit
from panda_store.ai.providers import PROVIDERS, ProviderError
from panda_store.core.credentials import CredentialsUnavailable, decrypt
from panda_store.core.models import AIConnection


class Command(BaseCommand):
    help = "Evaluate ASO on synthetic cases. Default: list cases, no network or credentials."
    requires_system_checks = []

    def add_arguments(self, parser):
        mode = parser.add_mutually_exclusive_group()
        mode.add_argument(
            "--live", action="store_true", help="Make paid provider calls explicitly."
        )
        mode.add_argument(
            "--replay", type=Path, help="Recheck a saved report.json without AI calls."
        )
        parser.add_argument(
            "--regrade-reason",
            help="Explicitly apply updated expectations to identical saved inputs; explain why.",
        )
        parser.add_argument("--workspace", help="Workspace UUID whose encrypted connection to use.")
        parser.add_argument("--provider", choices=list(PROVIDERS))
        parser.add_argument("--model")
        parser.add_argument("--case", action="append", dest="cases", help="Repeat to select cases.")
        parser.add_argument("--repeat", type=int, default=1)
        parser.add_argument(
            "--max-calls", type=int, help="Required for live runs; hard request cap."
        )
        parser.add_argument("--output", type=Path, help="New directory for JSON and HTML reports.")

    def handle(self, *args, **options):
        suite = load_suite()
        if options["regrade_reason"] and not options["replay"]:
            raise CommandError("--regrade-reason requires --replay.")
        if not options["live"] and not options["replay"]:
            self.stdout.write(
                f"{suite['version']}: {len(suite['cases'])} synthetic cases. No API calls."
            )
            for case in suite["cases"]:
                self.stdout.write(f"{case['id']}: {case['purpose']}")
            return
        directory = options["output"]
        if not directory:
            raise CommandError(
                "Choose a new --output directory. Existing results are never replaced."
            )
        if directory.exists():
            raise CommandError("The output directory already exists. Choose a new directory.")
        if options["replay"]:
            document = self.replay(suite, options)
        else:
            document, connection = self.prepare(suite, options)
        # Reserve and verify the output destination before the first paid request.
        directory.mkdir(parents=True, exist_ok=False, mode=0o700)
        self.save(directory, document)
        if options["live"]:
            for row in document["rows"]:
                started = time.monotonic()
                row.update(
                    status="in_progress",
                    error="No result was saved yet. The provider may still be processing this "
                    "request or may have billed it. Do not assume it was never sent.",
                )
                self.save(directory, document)
                try:
                    # Re-read revision for every call: a replaced key is never silently adopted.
                    current = AIConnection.objects.filter(
                        pk=connection.pk, revision=connection.revision
                    ).first()
                    if not current:
                        raise ProviderError("The connection changed. Start a new evaluation.")
                    output = editorial.generate(
                        connection.provider,
                        decrypt(current.encrypted_key),
                        options["model"],
                        editorial.INSTRUCTION,
                        row["context"],
                        editorial.SCHEMA,
                        max_output_tokens=editorial.MAX_OUTPUT_TOKENS,
                    )
                    row.update(
                        status="evaluated",
                        output=output,
                        assessment=assess(row["case"], row["inputs"], output),
                    )
                    row.pop("error", None)
                except (ProviderError, CredentialsUnavailable) as exc:
                    row.update(
                        status="error",
                        error=str(exc),
                        error_code=getattr(exc, "code", "credentials"),
                    )
                except Exception:
                    # Do not copy transport exceptions, credentials or tracebacks into artifacts.
                    row.update(
                        status="error", error="Unexpected evaluation error. No further calls made."
                    )
                row["duration_seconds"] = round(time.monotonic() - started, 3)
                self.save(directory, document)
                label = row["status"]
                if label == "evaluated":
                    label = (
                        "expectations met" if row["assessment"]["passed"] else "expectations missed"
                    )
                self.stdout.write(f"{row['case']['id']} / {row['attempt']}: {label}")
                self.stdout.flush()
                if row["status"] == "error":
                    break  # Never retry or continue spending after a provider/credential failure.
        summary = document["summary"]
        self.stdout.write(f"Report: {directory / 'report.html'}")
        self.stdout.write(
            f"Automated expectations: {summary['expectations_met']}/{summary['evaluated']}. "
            "Human review is pending; this is not a quality certification."
        )
        if (
            summary["errors"]
            or summary["expectations_missed"]
            or summary["not_run"]
            or summary["unfinished"]
        ):
            raise CommandError(
                "Evaluation has failures or incomplete attempts. Inspect the saved report."
            )

    def prepare(self, suite, options):
        if not all(options[key] for key in ("workspace", "provider", "model", "max_calls")):
            raise CommandError(
                "Live runs require --workspace, --provider, --model and --max-calls."
            )
        ids = set(options["cases"] or [case["id"] for case in suite["cases"]])
        if ids - {case["id"] for case in suite["cases"]}:
            raise CommandError("Unknown evaluation case. Run without arguments to list cases.")
        cases = [case for case in suite["cases"] if case["id"] in ids]
        count = len(cases) * options["repeat"]
        if not 1 <= options["repeat"] <= 5 or not count <= options["max_calls"] <= 50:
            raise CommandError(
                "Use 1–5 repeats and a --max-calls between the planned count and 50."
            )
        try:
            connection = AIConnection.objects.get(
                workspace_id=options["workspace"], provider=options["provider"]
            )
        except (AIConnection.DoesNotExist, ValidationError, ValueError):
            raise CommandError("Connect the selected provider in that workspace first.") from None
        if options["model"] not in [model["id"] for model in connection.model_catalog]:
            raise CommandError("Model absent from this connection's catalog. Refresh AI settings.")
        document = {
            "format": "panda-aso-evaluation-v1",
            "mode": "live",
            "created_at": datetime.now(UTC).isoformat(),
            "provider": options["provider"],
            "model": options["model"],
            "manifest": manifest(suite),
            "provenance": suite["provenance"],
            "rows": [],
        }
        for case in cases:
            inputs = case_inputs(case, options["provider"], options["model"])
            for attempt in range(1, options["repeat"] + 1):
                document["rows"].append(
                    {
                        "case": copy.deepcopy(case),
                        "attempt": attempt,
                        "inputs": inputs,
                        "context": editorial.review_context(inputs, audit(inputs)["checks"]),
                        "status": "not_run",
                        "error": "Not attempted; the run may have stopped early.",
                    }
                )
        self.stdout.write(
            f"Planned provider calls: {count}; output cap per call: "
            f"{editorial.MAX_OUTPUT_TOKENS} tokens. No retries or fallback."
        )
        return document, connection

    def replay(self, suite, options):
        if options["cases"] or options["repeat"] != 1 or options["provider"] or options["model"]:
            raise CommandError("Replay uses the original cases and model; do not override them.")
        try:
            if options["replay"].stat().st_size > 10_000_000:
                raise ValueError()
            document = json.loads(options["replay"].read_text(encoding="utf-8"))
            current_manifest = manifest(suite)
            prior_manifest = document["manifest"]
            regrade = options["regrade_reason"]
            if document["format"] != "panda-aso-evaluation-v1":
                raise ValueError()
            if prior_manifest != current_manifest:
                allowed = {"suite_version", "suite_sha256"} if regrade else set()
                if any(
                    prior_manifest.get(k) != v
                    for k, v in current_manifest.items()
                    if k not in allowed
                ):
                    raise ValueError()
            known = {case["id"]: case for case in suite["cases"]}
            if not 1 <= len(document["rows"]) <= 50:
                raise ValueError()
            for row in document["rows"]:
                current_case = known[row["case"]["id"]]
                if row["case"] != current_case and not regrade:
                    raise ValueError()
                expected = case_inputs(current_case, document["provider"], document["model"])
                if row["inputs"] != expected:
                    raise ValueError()
                if row["context"] != editorial.review_context(expected, audit(expected)["checks"]):
                    raise ValueError()
                if row["status"] not in {"evaluated", "error", "not_run", "in_progress"}:
                    raise ValueError()
                if regrade:
                    row.setdefault("prior_grades", []).append(
                        {
                            "manifest": prior_manifest,
                            "expected": row["case"]["expected"],
                            "checks": row.get("assessment", {}).get("checks", []),
                            "reason": regrade,
                        }
                    )
                    row["case"] = copy.deepcopy(current_case)
                if row["status"] == "evaluated":
                    row["assessment"] = assess(row["case"], row["inputs"], row["output"])
                    row.pop("error", None)
        except (OSError, ValueError, KeyError, TypeError):
            raise CommandError(
                "Cannot replay: invalid file or changed dataset, prompt or input contract. "
                "Use the matching code version or start a new live run."
            ) from None
        document["mode"] = "replay"
        if options["regrade_reason"]:
            document.setdefault("regrades", []).append(
                {
                    "prior_manifest": prior_manifest,
                    "reason": options["regrade_reason"],
                    "prior_summary": document["summary"],
                }
            )
            document["manifest"] = current_manifest
        document["replayed_at"] = datetime.now(UTC).isoformat()
        return document

    @staticmethod
    def save(directory, document):
        document["summary"] = summarize(document["rows"])
        for name, content in (
            (
                "report.json",
                json.dumps(document, indent=2, ensure_ascii=False, cls=DjangoJSONEncoder),
            ),
            ("report.html", render(document)),
        ):
            temporary = directory / (name + ".tmp")
            temporary.write_text(content + "\n", encoding="utf-8")
            temporary.chmod(0o600)
            temporary.replace(directory / name)
