import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from threading import Barrier
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from django.core.management import call_command
from django.db import close_old_connections
from django.utils import timezone

from panda_store.ai import providers
from panda_store.ai.errors import ProviderError
from panda_store.ai.pricing import cost, normalize, price_for
from panda_store.ai.usage import operation, operation_scope, reserve, settle, totals
from panda_store.core.models import AIBudget, AIUsage, Membership, Workspace
from panda_store.workflows.models import WorkflowRun

pytestmark = pytest.mark.django_db


def run_for(workspace, **kwargs):
    return SimpleNamespace(workspace_id=workspace.pk, pk=uuid.uuid4(), **kwargs)


def budget_for(workspace, **kwargs):
    budget, _ = AIBudget.objects.update_or_create(workspace=workspace, defaults=kwargs)
    return budget


def payload(model="gpt-4.1-mini"):
    return {"model": model, "max_output_tokens": 100, "input": "private prompt"}


def begin(workspace, model="gpt-4.1-mini", *, run=None):
    with operation_scope(run or run_for(workspace), "aso", "audit"):
        return reserve("openai", "/responses", payload(model))


def recorded(workspace, **kwargs):
    defaults = dict(
        operation_key="audit:test",
        operation_label="ASO audit",
        module="aso",
        model="gpt-4.1-mini",
        provider="openai",
        status="recorded",
        input_tokens=100,
        output_tokens=20,
        estimated_cost_usd=Decimal("1"),
        created_at=timezone.now(),
    )
    return AIUsage.objects.create(workspace=workspace, **(defaults | kwargs))


def test_provider_usage_counts_cache_and_reasoning_once():
    openai = normalize(
        "openai",
        {
            "usage": {
                "input_tokens": 1000,
                "output_tokens": 200,
                "input_tokens_details": {"cached_tokens": 300, "cache_write_tokens": 100},
                "output_tokens_details": {"reasoning_tokens": 150},
            }
        },
    )
    assert openai == dict(
        input_tokens=1000,
        output_tokens=200,
        cached_tokens=300,
        cache_write_tokens=100,
        cache_write_hour_tokens=0,
        reasoning_tokens=150,
    )
    assert cost(price_for("openai", "gpt-6.1-sol", date(2026, 10, 19)), openai) == Decimal(".00348")
    google = normalize(
        "google",
        {
            "usageMetadata": {
                "promptTokenCount": 1000,
                "candidatesTokenCount": 100,
                "thoughtsTokenCount": 200,
                "cachedContentTokenCount": 300,
            }
        },
    )
    assert google["input_tokens"] == 1000
    assert google["output_tokens"] == 300
    assert cost(price_for("google", "gemini-2.5-flash"), google) == Decimal(".000969")
    claude = normalize(
        "anthropic",
        {
            "usage": {
                "input_tokens": 600,
                "output_tokens": 200,
                "cache_read_input_tokens": 300,
                "cache_creation_input_tokens": 100,
                "cache_creation": {"ephemeral_1h_input_tokens": 40},
            }
        },
    )
    assert claude["input_tokens"] == 1000
    assert cost(price_for("anthropic", "claude-sonnet-4-6"), claude) == Decimal(".005355")
    glm = normalize(
        "zai",
        {
            "usage": {
                "prompt_tokens": 1000,
                "completion_tokens": 200,
                "prompt_tokens_details": {"cached_tokens": 300},
            }
        },
    )
    assert cost(price_for("zai", "glm-4.7"), glm) == Decimal(".000893")


@pytest.mark.parametrize(
    "usage",
    [
        None,
        {},
        {"input_tokens": True, "output_tokens": 1},
        {"input_tokens": -1, "output_tokens": 2},
        {"input_tokens": 3, "output_tokens": 1, "input_tokens_details": {"cached_tokens": 4}},
        {"input_tokens": 3, "output_tokens": 1, "output_tokens_details": {"reasoning_tokens": 2}},
    ],
)
def test_missing_or_invalid_counters_are_unknown(usage):
    assert normalize("openai", {"usage": usage}) is None


def test_free_unknown_promotions_and_long_context_prices():
    usage = {"input_tokens": 1000, "output_tokens": 200}
    assert cost(price_for("zai", "glm-4.7-flash"), usage) == 0
    assert cost(price_for("openai", "gpt-unknown"), usage) is None
    assert price_for("openai", "gpt-5.6-sol", date(2026, 11, 22)) == {}
    assert price_for("google", "gemini-4-argon", date(2026, 12, 1))["output"] == "20"
    before = cost(
        price_for("google", "gemini-2.5-pro"), {"input_tokens": 200000, "output_tokens": 100}
    )
    after = cost(
        price_for("google", "gemini-2.5-pro"), {"input_tokens": 200001, "output_tokens": 100}
    )
    assert before == Decimal(".251")
    assert after == Decimal(".5015025")


def test_http_boundary_records_usage_even_when_answer_is_rejected(workspace):
    response = {
        "status": "incomplete",
        "incomplete_details": {"reason": "max_output_tokens"},
        "usage": {"input_tokens": 50, "output_tokens": 100},
        "model": "gpt-4.1-mini",
    }
    with (
        operation_scope(run_for(workspace), "aso", "audit"),
        patch.object(providers, "_request", AsyncMock(return_value=json.dumps(response).encode())),
    ):
        with pytest.raises(ProviderError, match="output limit"):
            providers.generate(
                "openai",
                "secret-key",
                "gpt-4.1-mini",
                "private instruction",
                {"sensitive": "private app"},
                {"type": "object"},
                max_output_tokens=100,
            )
    row = AIUsage.objects.get()
    assert row.status == "recorded" and row.output_tokens == 100
    assert row.estimated_cost_usd == Decimal(".00018")
    saved = json.dumps(row.usage) + json.dumps(row.price) + row.error_code
    assert not any(secret in saved for secret in ("private", "secret-key", "sensitive"))


def test_timeout_reserves_uncertain_charge_until_reconciled(workspace):
    with (
        operation_scope(run_for(workspace), "studio", "social"),
        patch.object(providers, "_request", AsyncMock(side_effect=TimeoutError())),
    ):
        with pytest.raises(ProviderError) as caught:
            providers.request("openai", "secret", "/responses", payload=payload())
    assert caught.value.code == "timeout"
    row = AIUsage.objects.get()
    assert row.status == "unknown" and row.estimated_cost_usd is None
    assert row.reserved_cost_usd > 0 and row.reserved_tokens > 0
    assert totals([row])["reserved_usd"] == row.reserved_cost_usd


def test_scope_does_not_leak_and_catalog_gets_are_not_billed(workspace):
    with patch.object(providers, "_request", AsyncMock(return_value=b'{"data":[]}')):
        with operation_scope(run_for(workspace), "aso", "audit"):
            providers.request("openai", "secret", "/models")
        providers.request("openai", "secret", "/responses", payload=payload())
    assert AIUsage.objects.count() == 0


@pytest.mark.parametrize(
    "limits",
    [{"monthly_usd": 0}, {"operation_usd": 0}, {"monthly_tokens": 0}, {"operation_tokens": 0}],
)
def test_zero_limit_blocks_before_any_network(workspace, limits):
    budget_for(workspace, **limits)
    with (
        operation_scope(run_for(workspace), "aso", "audit"),
        patch.object(providers, "_request") as send,
    ):
        with pytest.raises(ProviderError) as caught:
            providers.request("openai", "secret", "/responses", payload=payload())
    assert caught.value.code == "budget_exceeded"
    send.assert_not_called()
    assert AIUsage.objects.count() == 0


def test_actual_usage_replaces_reservation_and_new_calls_share_budget(workspace):
    budget_for(workspace, monthly_usd=Decimal(".003"))
    first = begin(workspace)
    with pytest.raises(ProviderError, match="monthly limit"):
        begin(workspace)
    settle(first, {"usage": {"input_tokens": 10, "output_tokens": 2}})
    second = begin(workspace)
    result = totals(AIUsage.objects.all())
    assert result["reserved_usd"] == second.reserved_cost_usd
    assert result["cost_usd"] == Decimal(".0000072")
    assert result["tokens"] == 12


def test_retry_uses_root_operation_but_new_operation_gets_new_limit(workspace):
    first = WorkflowRun.objects.create(
        workspace=workspace, module_id="aso", workflow_key="audit", title="Audit"
    )
    retry = WorkflowRun.objects.create(
        workspace=workspace, module_id="aso", workflow_key="audit", title="Retry", retry_of=first
    )
    run = run_for(workspace, workflow_id=first.pk)
    retried = run_for(workspace, workflow_id=retry.pk)
    assert (
        operation(run, "aso", "audit")["operation_key"]
        == operation(retried, "aso", "audit")["operation_key"]
    )
    budget_for(workspace, operation_usd=Decimal(".003"))
    begin(workspace, run=run)
    with pytest.raises(ProviderError, match="operation's limit"):
        begin(workspace, run=retried)
    assert begin(workspace).pk


def test_social_planning_and_analysis_share_session_budget(workspace):
    run = run_for(workspace)
    first = operation(run, "studio", "social")
    run.workflow_id = uuid.uuid4()
    assert operation(run, "studio", "social")["operation_key"] == first["operation_key"]
    retried = run_for(workspace, inputs={"retry_operation_id": str(run.pk)})
    assert operation(retried, "studio", "social")["operation_key"] == first["operation_key"]


def test_unknown_price_blocks_monetary_caps_but_free_model_does_not(workspace):
    budget_for(workspace, monthly_usd=0)
    with pytest.raises(ProviderError) as caught:
        begin(workspace, model="gpt-future")
    assert caught.value.code == "budget_unpriced"
    with operation_scope(run_for(workspace), "studio", "social"):
        free = reserve("zai", "/chat/completions", {"model": "glm-4.7-flash", "max_tokens": 100})
    assert free.reserved_cost_usd == 0


def test_old_unknown_charge_is_carried_into_new_month(workspace):
    budget_for(workspace, monthly_usd=Decimal(".003"))
    row = begin(workspace)
    AIUsage.objects.filter(pk=row.pk).update(created_at=datetime(2026, 1, 1, tzinfo=UTC))
    with pytest.raises(ProviderError, match="monthly limit"):
        begin(workspace)
    settle(row, {"usage": {"input_tokens": 10, "output_tokens": 2}})
    assert begin(workspace).pk


def test_known_old_cost_does_not_reduce_new_month_budget(workspace):
    budget_for(workspace, monthly_usd=Decimal(".003"))
    recorded(workspace, created_at=datetime(2020, 1, 1, tzinfo=UTC), estimated_cost_usd=100)
    assert begin(workspace).pk


def test_unknown_existing_cost_blocks_cap_instead_of_assuming_zero(workspace):
    recorded(workspace, estimated_cost_usd=None)
    budget_for(workspace, monthly_usd=100)
    with pytest.raises(ProviderError) as caught:
        begin(workspace)
    assert caught.value.code == "budget_unknown"


@pytest.mark.parametrize(
    "field", ["monthly_usd", "operation_usd", "monthly_tokens", "operation_tokens"]
)
def test_each_limit_applies_independently_when_the_others_are_unlimited(workspace, field):
    run = run_for(workspace)
    key = operation(run, "aso", "audit")["operation_key"]
    monetary = field.endswith("usd")
    budget_for(workspace, **{field: 5 if monetary else 5000})
    recorded(
        workspace,
        operation_key=key,
        estimated_cost_usd=Decimal("4.17") if monetary else 9999,
        input_tokens=10**9 if monetary else 100,
        output_tokens=10**9 if monetary else 20,
    )
    if field.startswith("operation"):
        recorded(workspace, estimated_cost_usd=9999, input_tokens=10**9)
    assert begin(workspace, run=run).pk
    if monetary:
        recorded(workspace, operation_key=key, estimated_cost_usd=Decimal(".83"))
    calls = AIUsage.objects.count()
    with pytest.raises(ProviderError) as caught:
        begin(workspace, run=run)
    assert caught.value.code == "budget_exceeded"
    assert ("monthly" if field.startswith("monthly") else "operation") in str(caught.value)
    assert AIUsage.objects.count() == calls


def test_partial_history_allows_monthly_budget_and_keeps_known_costs_and_reservations(
    api,
    workspace,
):
    budget_for(workspace, monthly_usd=5)
    recorded(workspace, historical=True, estimated_cost_usd=Decimal("4.17"))
    old = [
        recorded(workspace, historical=True, estimated_cost_usd=None, input_tokens=10**6)
        for _ in range(3)
    ]
    assert begin(workspace).pk
    result = api.get(f"/api/workspaces/{workspace.pk}/ai-usage/").data
    assert result["current_month"]["historical_unpriced"] == 3
    assert result["current_month"]["unpriced"] == 3
    assert result["current_month"]["cost_usd"] == Decimal("4.17")
    for row in old:
        row.refresh_from_db()
        assert row.estimated_cost_usd is None and row.status == "recorded"
    recorded(
        workspace,
        status="unknown",
        estimated_cost_usd=None,
        reserved_cost_usd=Decimal(".83"),
    )
    with pytest.raises(ProviderError, match="monthly limit") as caught:
        begin(workspace)
    assert caught.value.code == "budget_exceeded"


@pytest.mark.parametrize("status", ["pending", "unknown"])
def test_unresolved_calls_still_block_even_if_marked_historical(workspace, status):
    budget_for(workspace, monthly_usd=5)
    recorded(workspace, historical=True, status=status, estimated_cost_usd=None)
    with pytest.raises(ProviderError) as caught:
        begin(workspace)
    assert caught.value.code == "budget_unknown"


def test_external_search_cannot_bypass_limits(workspace):
    budget_for(workspace, monthly_tokens=10**8)
    with operation_scope(run_for(workspace), "studio", "legacy"):
        with pytest.raises(ProviderError) as caught:
            reserve("openai", "/responses", {**payload(), "tools": [{"type": "web_search"}]})
    assert caught.value.code == "budget_tools"


def test_settings_permissions_validation_and_revision(api, workspace, owner):
    base = f"/api/workspaces/{workspace.pk}/ai-usage/"
    initial = api.get(base).data
    assert all(
        initial["budget"][key] is None
        for key in ("monthly_usd", "operation_usd", "monthly_tokens", "operation_tokens")
    )
    value = {
        key: initial["budget"][key]
        for key in (
            "revision",
            "monthly_usd",
            "operation_usd",
            "monthly_tokens",
            "operation_tokens",
        )
    }
    assert api.put(base + "limits/", {**value, "monthly_usd": -1}, format="json").status_code == 400
    assert (
        api.put(base + "limits/", {**value, "monthly_tokens": 1.5}, format="json").status_code
        == 400
    )
    assert (
        api.put(base + "limits/", {**value, "monthly_usd": "NaN"}, format="json").status_code == 400
    )
    saved = api.put(
        base + "limits/", {**value, "monthly_usd": "20", "operation_usd": "1"}, format="json"
    )
    assert saved.status_code == 200
    assert api.put(base + "limits/", value, format="json").status_code == 409
    Membership.objects.filter(workspace=workspace, user=owner).update(role="editor")
    assert (
        api.put(
            base + "limits/", {**value, "revision": saved.data["revision"]}, format="json"
        ).status_code
        == 403
    )
    assert api.get(base).status_code == 200
    unrelated = Workspace.objects.create(name="Other")
    assert api.get(f"/api/workspaces/{unrelated.pk}/ai-usage/").status_code == 404


def test_filtered_totals_do_not_change_monthly_budget_or_leak_other_workspace(api, workspace):
    budget_for(workspace, monthly_usd=10)
    recorded(workspace, estimated_cost_usd=8)
    recorded(workspace, module="studio", provider="google", estimated_cost_usd=1)
    other = Workspace.objects.create(name="Other")
    recorded(other, app_name="Hidden app", estimated_cost_usd=100)
    result = api.get(f"/api/workspaces/{workspace.pk}/ai-usage/?provider=google").data
    assert result["summary"]["cost_usd"] == 1
    assert result["current_month"]["cost_usd"] == 9
    assert result["alerts"] == ["usd"]
    assert "Hidden app" not in str(result)
    assert api.get(f"/api/workspaces/{workspace.pk}/ai-usage/?month=2026-99").status_code == 400


def test_reconciliation_requires_owner_confirmation_and_no_live_request(api, workspace):
    row = begin(workspace)
    url = f"/api/workspaces/{workspace.pk}/ai-usage/{row.pk}/reconcile/"
    values = {"cost_usd": "0", "input_tokens": 0, "output_tokens": 0, "confirmed": True}
    assert api.post(url, values, format="json").status_code == 400
    settle(row, error=ProviderError("timeout", code="timeout"))
    assert api.post(url, {**values, "confirmed": False}, format="json").status_code == 400
    result = api.post(url, values, format="json")
    assert result.status_code == 200
    row.refresh_from_db()
    assert row.status == "reconciled" and row.reconciled_by_id
    assert totals([row])["reserved_usd"] == 0
    assert api.post(url, values, format="json").status_code == 400


def test_historical_backfill_is_idempotent_and_skips_reused_steps(workspace):
    from addons.app_catalog.models import MobileApp
    from addons.aso.models import AuditRun
    from panda_store.workflows.models import StepRun

    app = MobileApp.objects.create(
        workspace=workspace, name="Example", platform="ios", external_id="test"
    )
    workflow = WorkflowRun.objects.create(
        workspace=workspace, module_id="aso", workflow_key="audit", title="Audit"
    )
    run = AuditRun.objects.create(
        workspace=workspace,
        workflow=workflow,
        app=app,
        request_id=uuid.uuid4(),
        locale="fr-FR",
        inputs={"ai": {"provider": "google", "model": "gemini-2.5-flash"}},
    )
    old = timezone.now() - timedelta(days=1)
    output = {
        "provider": "google",
        "usage": {"input_tokens": 100, "output_tokens": 10, "reasoning_tokens": 20},
    }
    step = StepRun.objects.create(
        run=workflow,
        key="editorial",
        kind="ai",
        position=1,
        title="Review",
        completed_at=old,
        output=output,
    )
    StepRun.objects.create(
        run=workflow,
        key="copied",
        kind="ai",
        position=2,
        title="Reused",
        reused_from=step,
        completed_at=old,
        output=output,
    )
    call_command("backfill_ai_usage")
    call_command("backfill_ai_usage")
    row = AIUsage.objects.get()
    assert row.input_tokens == 100 and row.output_tokens == 30
    assert row.historical and row.created_at == old
    assert row.operation_key == operation(run, "aso", "audit")["operation_key"]


@pytest.mark.django_db(transaction=True)
def test_concurrent_workers_cannot_reserve_the_same_remaining_budget():
    workspace = Workspace.objects.create(name="Concurrent")
    budget_for(workspace, monthly_usd=Decimal(".003"))
    barrier = Barrier(2)

    def worker():
        close_old_connections()
        try:
            barrier.wait(timeout=5)
            try:
                begin(workspace)
                return "reserved"
            except ProviderError as exc:
                return exc.code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: worker(), range(2)))
    assert sorted(results) == ["budget_exceeded", "reserved"]
    assert AIUsage.objects.filter(workspace=workspace).count() == 1


def test_cli_evaluation_case_without_workflow_keeps_one_operation(workspace):
    case = SimpleNamespace(workspace_id=workspace.pk)
    first = operation(case, "aso", "audit")
    assert first["operation_key"] == operation(case, "aso", "audit")["operation_key"]
    with operation_scope(case, "aso", "audit"):
        assert reserve("openai", "/responses", payload()).workspace_id == workspace.pk
