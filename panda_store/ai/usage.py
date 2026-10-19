"""Workspace accounting at the HTTP boundary, including invalid and unfinished answers."""

import json
import time
import uuid
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import UTC, datetime
from functools import wraps

from django.db import OperationalError, transaction
from django.db.models import F, Q
from django.utils import timezone

from panda_store.core.models import AIBudget, AIUsage
from panda_store.workflows.models import WorkflowRun

from .errors import ProviderError
from .pricing import cost, normalize, price_for

_scope = ContextVar("ai_usage_scope", default=None)
LIMIT_FIELDS = ("monthly_usd", "operation_usd", "monthly_tokens", "operation_tokens")
OUTSTANDING = ("pending", "unknown")


def operation(run, module, kind):
    workflow_id = getattr(run, "workflow_id", None)
    root = workflow_id
    if kind != "social" and root:
        while (
            parent := WorkflowRun.objects.filter(pk=root)
            .values_list("retry_of_id", flat=True)
            .first()
        ):
            root = parent
    app = getattr(run, "app", None)
    identity = getattr(run, "pk", None) or getattr(run, "_ai_usage_operation_id", None)
    if identity is None:
        # CLI evaluations use a namespace instead of a saved workflow. Its case's
        # calls still share a budget and count toward the connected workspace.
        identity = uuid.uuid4()
        run._ai_usage_operation_id = identity
    if kind == "social":
        identity = getattr(run, "inputs", {}).get("retry_operation_id", identity)
    return {
        "workspace_id": run.workspace_id,
        "operation_key": f"{kind}:{identity if kind == 'social' else root or identity}",
        "operation_label": {
            "audit": "ASO audit",
            "social": "Social research",
            "scripts": "Script generation",
            "legacy": "Public page research",
            "connection": "Connection check",
        }[kind],
        "module": module,
        "app_id": getattr(run, "app_id", None),
        "app_name": getattr(app, "name", "")[:255],
        "workflow_id": workflow_id,
    }


@contextmanager
def operation_scope(run, module, kind):
    # Standalone evaluations without a persisted workspace are outside workspace accounting.
    if not getattr(run, "workspace_id", None):
        yield
        return
    token = _scope.set(operation(run, module, kind))
    try:
        yield
    finally:
        _scope.reset(token)


def tracked_operation(module, kind):
    def decorate(fn):
        @wraps(fn)
        def wrapped(run, *args, **kwargs):
            with operation_scope(run, module, kind):
                return fn(run, *args, **kwargs)

        return wrapped

    return decorate


def month_start(now=None):
    now = (now or timezone.now()).astimezone(UTC)
    return datetime(now.year, now.month, 1, tzinfo=UTC)


def totals(rows):
    result = {
        "calls": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "cached_tokens": 0,
        "reasoning_tokens": 0,
        "tokens": 0,
        "cost_usd": 0,
        "reserved_usd": 0,
        "reserved_tokens": 0,
        "pending": 0,
        "unknown": 0,
        "unpriced": 0,
        "historical": 0,
        "historical_unpriced": 0,
    }
    for row in rows:
        result["calls"] += 1
        result["historical"] += int(row.historical)
        for field in ("input_tokens", "output_tokens", "cached_tokens", "reasoning_tokens"):
            result[field] += getattr(row, field) or 0
        result["tokens"] += (row.input_tokens or 0) + (row.output_tokens or 0)
        result["cost_usd"] += row.estimated_cost_usd or 0
        if row.status in OUTSTANDING:
            result[row.status] += 1
            result["reserved_usd"] += row.reserved_cost_usd or 0
            result["reserved_tokens"] += row.reserved_tokens
        if row.estimated_cost_usd is None and (
            row.status not in OUTSTANDING or row.reserved_cost_usd is None
        ):
            result["unpriced"] += 1
            if row.historical and row.status == "recorded":
                result["historical_unpriced"] += 1
    return result


def reservation_tokens(payload):
    """Conservative local allowance, not a tokenizer or an invoice guarantee.

    Text uses UTF-8 bytes plus protocol allowance. Images have a separate high
    allowance; base64 length must never be confused with text tokens.
    """
    images = 0

    def scrub(value):
        nonlocal images
        if isinstance(value, dict):
            if value.get("type") in {"input_image", "image", "image_url"} or "inlineData" in value:
                images += 1
                return "[image]"
            return {k: scrub(v) for k, v in value.items()}
        if isinstance(value, list):
            return [scrub(v) for v in value]
        return value

    size = len(json.dumps(scrub(payload), ensure_ascii=False).encode("utf-8"))
    output = payload.get("max_output_tokens", payload.get("max_tokens"))
    if output is None:
        output = payload.get("generationConfig", {}).get("maxOutputTokens")
    if type(output) is not int or not 1 <= output <= 1_000_000:
        raise ProviderError("AI usage could not reserve this request's output limit.")
    return {"input_tokens": size + 4096 + 32000 * images, "output_tokens": output}


def external_tools(payload):
    return any(
        isinstance(tool, dict)
        and (
            str(tool.get("type", "")).startswith("web_search")
            or "google_search" in tool
            or "googleSearch" in tool
        )
        for tool in payload.get("tools", [])
    )


def lock_budget(workspace_id):
    # Caller must already be in an atomic block. This WRITE also serializes SQLite,
    # where select_for_update alone cannot protect concurrent reservations.
    AIBudget.objects.filter(workspace_id=workspace_id).update(lock_version=F("lock_version") + 1)
    return AIBudget.objects.get(workspace_id=workspace_id)


def reserve(provider, path, payload):
    for attempt in range(8):
        try:
            return _reserve(provider, path, payload)
        except OperationalError as exc:
            if "locked" not in str(exc).lower() or attempt == 7:
                raise
            time.sleep(0.01 * (attempt + 1))


def _reserve(provider, path, payload):
    context = _scope.get()
    if context is None or payload is None:
        return None
    model = payload.get("model") or path.removeprefix("/models/").split(":")[0]
    now = timezone.now()
    price = price_for(provider, model, now.date())
    tools = external_tools(payload)
    if tools:
        price = {}  # Provider search fees cannot be bounded from this request.
    allowance = reservation_tokens(payload)
    reserved = cost(price, allowance, reserve=True)
    tokens = sum(allowance.values())
    AIBudget.objects.get_or_create(workspace_id=context["workspace_id"])
    with transaction.atomic():
        budget = lock_budget(context["workspace_id"])
        enabled = any(getattr(budget, field) is not None for field in LIMIT_FIELDS)
        if tools and enabled:
            raise ProviderError(
                "Provider web search has unbounded tool fees. Use SMM browser research "
                "while AI limits are enabled.",
                code="budget_tools",
            )
        if reserved is None and (
            budget.monthly_usd is not None or budget.operation_usd is not None
        ):
            raise ProviderError(
                "This model has no verified price. "
                "Choose a priced model to respect your AI budget.",
                code="budget_unpriced",
            )
        rows = AIUsage.objects.filter(workspace_id=context["workspace_id"])
        for period, selected in (
            (
                "monthly",
                rows.filter(Q(created_at__gte=month_start(now)) | Q(status__in=OUTSTANDING)),
            ),
            ("operation", rows.filter(operation_key=context["operation_key"])),
        ):
            dollars = getattr(budget, period + "_usd")
            token_limit = getattr(budget, period + "_tokens")
            if dollars is None and token_limit is None:
                continue
            used = totals(selected)
            # Recovered history is explicitly partial. Missing historical prices
            # stay unknown but do not prevent using an estimated budget. Known
            # historical charges and all live reservations still consume it.
            if dollars is not None and used["unpriced"] > used["historical_unpriced"]:
                raise ProviderError(
                    "Some AI costs are unknown. Reconcile them in AI usage before continuing.",
                    code="budget_unknown",
                )
            if (
                dollars is not None and used["cost_usd"] + used["reserved_usd"] + reserved > dollars
            ) or (
                token_limit is not None
                and used["tokens"] + used["reserved_tokens"] + tokens > token_limit
            ):
                raise ProviderError(
                    "The next AI call would exceed the monthly limit. Review AI usage and limits."
                    if period == "monthly"
                    else (
                        "The next AI call would exceed this operation's limit. "
                        "Review AI usage and limits."
                    ),
                    code="budget_exceeded",
                )
        return AIUsage.objects.create(
            **context,
            provider=provider,
            model=model,
            created_at=now,
            price=price,
            reserved_tokens=tokens,
            reserved_cost_usd=reserved,
        )


def settle(row, data=None, error=None):
    if row is None:
        return
    usage = normalize(row.provider, data or {})
    fields = {"completed_at": timezone.now(), "status": "recorded" if usage else "unknown"}
    if usage:
        fields.update({k: v for k, v in usage.items() if k != "cache_write_hour_tokens"})
        fields["usage"] = usage
        # A nonstandard service tier has a different price, not a zero price.
        tier = (data or {}).get("service_tier", "default")
        fields["estimated_cost_usd"] = (
            cost(row.price, usage) if tier in {None, "default", "standard", "auto"} else None
        )
    fields["resolved_model"] = str(
        (data or {}).get("modelVersion") or (data or {}).get("model") or ""
    )[:120]
    if error:
        fields["error_code"] = getattr(error, "code", "transport_error")[:64]
    with transaction.atomic():
        lock_budget(row.workspace_id)
        AIUsage.objects.filter(pk=row.pk, status="pending").update(**fields)


def metered_request(provider, path, payload, send):
    row = reserve(provider, path, payload)
    try:
        data = send()
    except BaseException as exc:
        settle(row, error=exc)
        raise
    settle(row, data)
    return data
