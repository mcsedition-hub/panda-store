import uuid
from collections import defaultdict
from datetime import UTC, datetime, timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from panda_store.core.access import workspace_access
from panda_store.core.models import AIBudget, AIUsage
from panda_store.workflows.models import WorkflowRun

from .pricing import SOURCES, VERIFIED
from .usage import LIMIT_FIELDS, OUTSTANDING, lock_budget, month_start, totals


class BudgetInput(serializers.Serializer):
    revision = serializers.UUIDField()
    monthly_usd = serializers.DecimalField(
        max_digits=14, decimal_places=6, min_value=0, allow_null=True
    )
    operation_usd = serializers.DecimalField(
        max_digits=14, decimal_places=6, min_value=0, allow_null=True
    )
    monthly_tokens = serializers.IntegerField(min_value=0, max_value=10**12, allow_null=True)
    operation_tokens = serializers.IntegerField(min_value=0, max_value=10**12, allow_null=True)


class UsageQuery(serializers.Serializer):
    month = serializers.RegexField(r"^\d{4}-\d{2}$", required=False)
    provider = serializers.ChoiceField(choices=list(SOURCES), required=False)
    app = serializers.UUIDField(required=False)
    module = serializers.ChoiceField(choices=["aso", "studio", "core"], required=False)
    offset = serializers.IntegerField(min_value=0, max_value=10**9, default=0)


def budget_data(budget):
    return {
        "revision": str(budget.revision),
        "tracking_started_at": budget.tracking_started_at,
        **{key: getattr(budget, key) for key in LIMIT_FIELDS},
    }


def can_reconcile(row):
    if row.reconciled_at or (row.status not in OUTSTANDING and row.estimated_cost_usd is not None):
        return False
    if row.status != "pending":
        return True
    # A crashed worker leaves its reservation intact. Never release a live call.
    if row.created_at + timedelta(seconds=settings.PANDA_AI_TIMEOUT_SECONDS + 60) > timezone.now():
        return False
    return not WorkflowRun.objects.filter(
        pk=row.workflow_id, status__in=["running", "queued", "canceling"]
    ).exists()


def call_data(row):
    return {
        "id": str(row.pk),
        "operation_key": row.operation_key,
        "label": row.operation_label,
        "module": row.module,
        "app_id": str(row.app_id) if row.app_id else None,
        "app_name": row.app_name,
        "provider": row.provider,
        "model": row.model,
        "resolved_model": row.resolved_model,
        "status": row.status,
        "input_tokens": row.input_tokens,
        "output_tokens": row.output_tokens,
        "cached_tokens": row.cached_tokens,
        "cache_write_tokens": row.cache_write_tokens,
        "reasoning_tokens": row.reasoning_tokens,
        "cost_usd": row.estimated_cost_usd,
        "reserved_usd": row.reserved_cost_usd if row.status in OUTSTANDING else None,
        "reserved_tokens": row.reserved_tokens if row.status in OUTSTANDING else 0,
        "created_at": row.created_at,
        "historical": row.historical,
        "reconciled_at": row.reconciled_at,
        "can_reconcile": can_reconcile(row),
        "price": row.price,
        "error_code": row.error_code,
    }


@api_view(["GET"])
def dashboard(request, workspace_id):
    workspace_access(request.user, workspace_id)
    query = UsageQuery(data=request.query_params)
    query.is_valid(raise_exception=True)
    values = query.validated_data
    month = values.get("month", month_start().strftime("%Y-%m"))
    try:
        start = datetime.strptime(month, "%Y-%m").replace(tzinfo=UTC)
        end = (start + timedelta(days=32)).replace(day=1)
    except (ValueError, OverflowError):
        raise ValidationError("Choose a valid month.") from None
    budget, _ = AIBudget.objects.get_or_create(workspace_id=workspace_id)
    all_rows = AIUsage.objects.filter(workspace_id=workspace_id)
    selected = all_rows.filter(created_at__gte=start, created_at__lt=end)
    for key, field in (("provider", "provider"), ("app", "app_id"), ("module", "module")):
        if values.get(key):
            selected = selected.filter(**{field: values[key]})
    rows = list(selected.defer("usage", "price").order_by("-created_at"))
    grouped = {key: defaultdict(list) for key in ("provider", "app_id", "operation_key")}
    for row in rows:
        for key in grouped:
            grouped[key][str(getattr(row, key) or "")].append(row)
    operations = []
    for key, items in grouped["operation_key"].items():
        row = items[0]
        operations.append(
            {
                "key": key,
                "label": row.operation_label,
                "app_name": row.app_name,
                "module": row.module,
                "last_at": row.created_at,
                **totals(items),
            }
        )
    current = totals(all_rows.filter(Q(created_at__gte=month_start()) | Q(status__in=OUTSTANDING)))
    alerts = []
    for unit, used in (
        ("usd", current["cost_usd"] + current["reserved_usd"]),
        ("tokens", current["tokens"] + current["reserved_tokens"]),
    ):
        limit = getattr(budget, "monthly_" + unit)
        if limit is not None and used * 100 >= limit * 80:
            alerts.append(unit)
    offset = values["offset"]
    return Response(
        {
            "month": month,
            "months": [
                value.strftime("%Y-%m")
                for value in all_rows.datetimes("created_at", "month", tzinfo=UTC)
            ],
            "currency": "USD",
            "summary": totals(rows),
            "current_month": current,
            "alerts": alerts,
            "budget": budget_data(budget),
            "sources": SOURCES,
            "prices_verified_at": VERIFIED,
            "apps": [
                {"id": str(item["app_id"]), "name": item["app_name"]}
                for item in all_rows.exclude(app_id=None).values("app_id", "app_name").distinct()
            ],
            "by_provider": [
                {"provider": key, **totals(items)} for key, items in grouped["provider"].items()
            ],
            "by_app": [
                {"app_id": key, "app_name": items[0].app_name, **totals(items)}
                for key, items in grouped["app_id"].items()
            ],
            "operations": operations[:100],
            "operation_count": len(operations),
            "calls": [
                call_data(row) for row in selected.order_by("-created_at")[offset : offset + 50]
            ],
            "next_offset": offset + 50 if len(rows) > offset + 50 else None,
        }
    )


@api_view(["PUT"])
def limits(request, workspace_id):
    workspace_access(request.user, workspace_id, owner=True)
    data = BudgetInput(data=request.data)
    data.is_valid(raise_exception=True)
    AIBudget.objects.get_or_create(workspace_id=workspace_id)
    with transaction.atomic():
        budget = lock_budget(workspace_id)
        if budget.revision != data.validated_data["revision"]:
            return Response({"error": "AI limits changed. Reload before saving."}, status=409)
        for field in LIMIT_FIELDS:
            setattr(budget, field, data.validated_data[field])
        budget.revision = uuid.uuid4()
        budget.save(update_fields=[*LIMIT_FIELDS, "revision"])
    return Response(budget_data(budget))


class ReconcileInput(serializers.Serializer):
    cost_usd = serializers.DecimalField(max_digits=18, decimal_places=8, min_value=0)
    input_tokens = serializers.IntegerField(min_value=0, max_value=10**12)
    output_tokens = serializers.IntegerField(min_value=0, max_value=10**12)
    confirmed = serializers.BooleanField()


@api_view(["POST"])
def reconcile(request, workspace_id, usage_id):
    workspace_access(request.user, workspace_id, owner=True)
    data = ReconcileInput(data=request.data)
    data.is_valid(raise_exception=True)
    value = data.validated_data
    if not value["confirmed"]:
        raise ValidationError("Verify this request in your provider's billing before reconciling.")
    with transaction.atomic():
        lock_budget(workspace_id)
        row = get_object_or_404(AIUsage, pk=usage_id, workspace_id=workspace_id)
        if not can_reconcile(row):
            raise ValidationError("This call is still active or has already been reconciled.")
        for field in ("input_tokens", "output_tokens"):
            if getattr(row, field) is not None and value[field] != getattr(row, field):
                raise ValidationError("Keep the token counts already reported by the provider.")
            setattr(row, field, value[field])
        row.estimated_cost_usd = value["cost_usd"]
        row.reconciled_by = request.user
        row.reconciled_at = timezone.now()
        row.status = "reconciled"
        row.save(
            update_fields=[
                "input_tokens",
                "output_tokens",
                "estimated_cost_usd",
                "reconciled_by",
                "reconciled_at",
                "status",
            ]
        )
    return Response(call_data(row))
