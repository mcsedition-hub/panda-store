"""Small, labeled regression set for the evidence reviewer, separate from copy quality."""

import json
from datetime import UTC, datetime
from importlib.resources import files
from pathlib import Path
from types import SimpleNamespace

from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError

from addons.aso import grounding
from addons.aso.evaluation.suite import case_inputs
from panda_store.ai.providers import PROVIDERS, ProviderError
from panda_store.core.credentials import CredentialsUnavailable
from panda_store.core.models import AIConnection


class Command(BaseCommand):
    help = "Check the evidence reviewer on fixed synthetic responses. Default: offline list."
    requires_system_checks = []

    def add_arguments(self, parser):
        parser.add_argument("--live", action="store_true")
        parser.add_argument("--workspace")
        parser.add_argument("--provider", choices=list(PROVIDERS))
        parser.add_argument("--model")
        parser.add_argument("--max-calls", type=int)
        parser.add_argument("--output", type=Path)

    def handle(self, *args, **options):
        fixture = json.loads(
            files("addons.aso.evaluation").joinpath("grounding_cases.json").read_text("utf-8")
        )
        if not options["live"]:
            self.stdout.write(f"{len(fixture['cases'])} evidence-review cases. No API calls.")
            return
        if not all(
            options.get(key) for key in ("workspace", "provider", "model", "max_calls", "output")
        ):
            raise CommandError(
                "Specify --workspace, --provider, --model, --max-calls and --output."
            )
        if not len(fixture["cases"]) <= options["max_calls"] <= 50:
            raise CommandError("--max-calls must cover the case count and be at most 50.")
        directory = options["output"]
        if directory.exists():
            raise CommandError("The output directory already exists. Choose a new directory.")
        try:
            connection = AIConnection.objects.get(
                workspace_id=options["workspace"], provider=options["provider"]
            )
        except (AIConnection.DoesNotExist, ValidationError, ValueError):
            raise CommandError("Connect this provider in the selected workspace first.") from None
        if options["model"] not in [item["id"] for item in connection.model_catalog]:
            raise CommandError("Choose a model from the connected provider's catalog.")
        document = {
            "created_at": datetime.now(UTC).isoformat(),
            "fixture_version": fixture["version"],
            "fixture_sha256": grounding.fingerprint(fixture),
            "review_version": grounding.VERSION,
            "instruction_sha256": grounding.fingerprint(grounding.INSTRUCTION),
            "human_review": "pending; labels are project judgments, not expert calibration",
            "provider": options["provider"],
            "model": options["model"],
            "rows": [{"case": case, "status": "not_run"} for case in fixture["cases"]],
        }
        directory.mkdir(parents=True, exist_ok=False, mode=0o700)

        def save():
            temp = directory / "report.tmp"
            temp.write_text(
                json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
            temp.chmod(0o600)
            temp.replace(directory / "report.json")

        save()
        self.stdout.write(
            f"Planned calls: {len(fixture['cases'])}; "
            f"cap: {grounding.MAX_OUTPUT_TOKENS} output tokens per call."
        )
        for row in document["rows"]:
            inputs = case_inputs(row["case"], options["provider"], options["model"])
            inputs["ai"].update(connection_id=str(connection.pk), revision=str(connection.revision))
            # Isolate the known proposal: no synthetic judge verdict enters its context.
            report = {"checks": [row["case"]["candidate"]], "editorial": {"assessments": []}}
            row.update(status="in_progress", context=grounding.context(inputs, report))
            save()
            try:
                output = grounding.review(
                    SimpleNamespace(inputs=inputs, workspace_id=connection.workspace_id), report
                )
                row["output"] = output
                # Apply the same completeness and context-binding checks as production.
                report.update(counts={"recommendation": 1})
                report["editorial"].update(accepted_proposals=1, rejected_proposals=0)
                grounding.apply(output, inputs, report)
                reviews = output["result"]["reviews"]
                row.update(
                    status="evaluated", passed=reviews[0]["verdict"] == row["case"]["expected"]
                )
            except (ProviderError, CredentialsUnavailable) as exc:
                row.update(status="error", error=str(exc))
            except Exception:
                row.update(status="error", error="Unexpected review error. No further calls made.")
            save()
            self.stdout.write(f"{row['case']['id']}: {row.get('passed', row['status'])}")
            self.stdout.flush()
            if row["status"] == "error":
                break
        passed = sum(row.get("passed", False) for row in document["rows"])
        self.stdout.write(
            f"{passed}/{len(fixture['cases'])} expected verdicts. "
            f"Report: {directory / 'report.json'}"
        )
        if passed != len(fixture["cases"]):
            raise CommandError(
                "Review expectations missed or calls incomplete. Inspect the report."
            )
