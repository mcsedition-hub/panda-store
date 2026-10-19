"""Import surviving counters once, never infer missing calls or duplicate reused checkpoints."""

from django.apps import apps
from django.core.management.base import BaseCommand
from django.db import transaction

from panda_store.ai.pricing import cost, price_for
from panda_store.ai.usage import lock_budget, operation
from panda_store.core.models import AIBudget, AIUsage, Workspace
from panda_store.workflows.models import StepRun


def stored_usage(raw, provider):
    if not isinstance(raw, dict):
        return None
    inp, out = raw.get("input_tokens"), raw.get("output_tokens")
    reasoning = raw.get("reasoning_tokens") or 0
    if any(type(v) is not int or not 0 <= v <= 10**12 for v in (inp, out, reasoning)):
        return None
    # Existing Google adapters stored visible output separately from thinking.
    if provider == "google":
        out += reasoning
    result = {"input_tokens": inp, "output_tokens": out}
    if raw.get("reasoning_tokens") is not None:
        result["reasoning_tokens"] = reasoning
    return result


def import_call(run, module, kind, source, output, created_at, *, tools=False):
    if not isinstance(output, dict):
        return False
    choice = run.inputs.get("ai", {})
    provider = output.get("provider") or choice.get("provider")
    model = choice.get("model") or output.get("model", "")
    usage = stored_usage(output.get("usage"), provider)
    if not usage:
        return False
    metadata = operation(run, module, kind)
    with transaction.atomic():
        budget = lock_budget(run.workspace_id)
        # Only import pre-tracking operations. A partial live operation cannot be
        # matched safely to historical steps; conservatively leave it partial.
        if (
            created_at >= budget.tracking_started_at
            or AIUsage.objects.filter(
                workspace_id=run.workspace_id,
                operation_key=metadata["operation_key"],
                historical=False,
            ).exists()
        ):
            return False
        price = {} if tools else price_for(provider, model)
        row, created = AIUsage.objects.get_or_create(
            source_key=source,
            defaults={
                **metadata,
                "provider": provider,
                "model": model,
                "resolved_model": output.get("resolved_model") or output.get("model", ""),
                "created_at": created_at,
                "completed_at": created_at,
                "status": "recorded",
                "historical": True,
                "usage": usage,
                **usage,
                "price": price,
                "estimated_cost_usd": cost(price, usage),
            },
        )
        if (
            not created
            and row.historical
            and row.reasoning_tokens == 0
            and ("reasoning_tokens" not in usage and not row.reconciled_at)
        ):
            # Earlier recovery omitted the distinction between zero and unavailable.
            AIUsage.objects.filter(pk=row.pk).update(reasoning_tokens=None, usage=usage)
        return created


class Command(BaseCommand):
    help = "Recover saved ASO/SMM token counters (partial historical estimates, no provider calls)."

    def handle(self, *args, **options):
        for workspace in Workspace.objects.all():
            AIBudget.objects.get_or_create(workspace=workspace)
        count = 0
        for app, name, kind in (
            ("aso", "AuditRun", "audit"),
            ("studio", "GenerationRun", "scripts"),
            ("studio", "ResearchRun", "legacy"),
        ):
            try:
                model = apps.get_model(app, name)
            except LookupError:
                continue
            for run in model.objects.select_related("app").exclude(workflow=None).iterator():
                for step in StepRun.objects.filter(
                    run_id=run.workflow_id, reused_from=None
                ).exclude(output=None):
                    count += import_call(
                        run,
                        app,
                        kind,
                        f"step:{step.pk}",
                        step.output,
                        step.completed_at or step.started_at or run.created_at,
                        tools=step.key == "discover",
                    )
        try:
            social = apps.get_model("studio", "SocialResearch")
        except LookupError:
            social = None
        if social:
            for run in social.objects.select_related("app").iterator():
                count += import_call(
                    run, "studio", "social", f"social:{run.pk}:plan", run.plan, run.created_at
                )
                for post in run.posts.exclude(analysis={}):
                    for index, output in enumerate(post.analysis.get("calls", [])):
                        count += import_call(
                            run,
                            "studio",
                            "social",
                            f"post:{post.pk}:{index}",
                            output,
                            post.captured_at,
                        )
        self.stdout.write(
            f"Recovered {count} historical calls. History is partial; no API calls made."
        )
