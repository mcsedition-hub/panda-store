"""Reviewed standard, paid API list prices in USD per million tokens.

Freeze a price snapshot with each request. Unknown IDs are never assumed free.
See docs/ai-usage.md for scope, official sources and historical limitations.
"""

from datetime import UTC, date, datetime
from decimal import Decimal

VERIFIED = "2026-10-19"
SOURCES = {
    "openai": "https://developers.openai.com/api/docs/pricing",
    "google": "https://ai.google.dev/gemini-api/docs/pricing",
    "anthropic": "https://platform.claude.com/docs/en/about-claude/pricing",
    "zai": "https://docs.z.ai/guides/overview/pricing",
}
# input, output, cache read, cache write (5 minutes), cache write (1 hour)
RATES = {
    "openai": {
        "gpt-6-astra": (10, 50, 1, 12.5),
        "gpt-6.1-sol": (2, 10, 0.1, 2.5),
        "gpt-6-sol": (2, 10, 0.2, 2.5),
        "gpt-6-luna": (0.1, 0.5, 0.01, 0.125),
        "gpt-5.6-sol": (4, 20, 0.4, 5),
        "gpt-5.6": (4, 20, 0.4, 5),
        "gpt-5.6-terra": (2, 12, 0.2, 2.5),
        "gpt-5.6-luna": (0.2, 1.2, 0.02, 0.25),
        "gpt-5.5": (5, 30, 0.5),
        "gpt-5.4": (2.5, 15, 0.25),
        "gpt-5.4-mini": (0.75, 4.5, 0.075),
        "gpt-5.4-nano": (0.2, 1.25, 0.02),
        "gpt-5.2": (1.75, 14, 0.175),
        "gpt-5.1": (1.25, 10, 0.125),
        "gpt-5": (1.25, 10, 0.125),
        "gpt-5-mini": (0.25, 2, 0.025),
        "gpt-5-nano": (0.05, 0.4, 0.005),
        "gpt-4.1": (2, 8, 0.5),
        "gpt-4.1-mini": (0.4, 1.6, 0.1),
        "gpt-4.1-nano": (0.1, 0.4, 0.025),
        "gpt-4o": (2.5, 10, 1.25),
        "gpt-4o-mini": (0.15, 0.6, 0.075),
    },
    "google": {
        "gemini-4-argon": (2, 10, 0.1),
        "gemini-3.8-flash": (0.75, 3.75, 0.075),
        "gemini-3.6-flash": (0.75, 3.75, 0.075),
        "gemini-3.5-flash-lite": (0.3, 2.5, 0.03),
        "gemini-2.5-pro": (1.25, 10, 0.125),
        "gemini-2.5-flash": (0.3, 2.5, 0.03),
        "gemini-2.5-flash-lite": (0.1, 0.4, 0.01),
    },
    "anthropic": {
        "claude-fable-5-1": (10, 50, 0.25, 12.5, 20),
        "claude-mythos-5-1": (10, 50, 0.25, 12.5, 20),
        "claude-opus-5-5": (4, 20, 0.2, 5, 8),
        "claude-sonnet-5-5": (2, 10, 0.1, 2.5, 4),
        "claude-haiku-5-5": (0.1, 0.5, 0.01, 0.125, 0.2),
        "claude-fable-5": (10, 50, 1, 12.5, 20),
        "claude-mythos-5": (10, 50, 1, 12.5, 20),
        "claude-opus-5": (5, 25, 0.5, 6.25, 10),
        "claude-opus-4-8": (5, 25, 0.5, 6.25, 10),
        "claude-opus-4-7": (5, 25, 0.5, 6.25, 10),
        "claude-opus-4-6": (5, 25, 0.5, 6.25, 10),
        "claude-opus-4-5": (5, 25, 0.5, 6.25, 10),
        "claude-opus-4-1": (15, 75, 1.5, 18.75, 30),
        "claude-opus-4": (15, 75, 1.5, 18.75, 30),
        "claude-sonnet-5": (2, 10, 0.2, 2.5, 4),
        "claude-sonnet-4-6": (3, 15, 0.3, 3.75, 6),
        "claude-sonnet-4-5": (3, 15, 0.3, 3.75, 6),
        "claude-sonnet-4": (3, 15, 0.3, 3.75, 6),
        "claude-haiku-4-5": (1, 5, 0.1, 1.25, 2),
    },
    "zai": {
        "glm-5.3": (1.4, 4.4, 0.26),
        "glm-5.2": (1.4, 4.4, 0.26),
        "glm-5.1": (1.4, 4.4, 0.26),
        "glm-5": (1, 3.2, 0.2),
        "glm-4.7": (0.6, 2.2, 0.11),
        "glm-4.6": (0.6, 2.2, 0.11),
        "glm-4.6v": (0.3, 0.9, 0.05),
        "glm-4.6v-flashx": (0.04, 0.4, 0.004),
        "glm-4.7-flashx": (0.07, 0.4, 0.01),
        "glm-4.7-flash": (0, 0, 0),
        "glm-4.5-flash": (0, 0, 0),
        "glm-4.6v-flash": (0, 0, 0),
    },
}


def price_for(provider, model, day=None):
    day = day or datetime.now(UTC).date()
    rates = RATES.get(provider, {}).get(model)
    # A known promotion has no published successor: do not extrapolate it.
    if provider == "openai" and model in {"gpt-5.6", "gpt-5.6-sol"}:
        if day > date(2026, 11, 21):
            return {}
    if rates is None:
        return {}
    result = dict(
        zip(("input", "output", "cached", "write", "write_hour"), map(str, rates), strict=False)
    )
    result.update(provider=provider, model=model, verified_at=VERIFIED, source=SOURCES[provider])
    if provider == "google" and (
        (model == "gemini-4-argon" and day >= date(2026, 12, 1))
        or (model in {"gemini-3.8-flash", "gemini-3.6-flash"} and day >= date(2027, 1, 1))
    ):
        for key in ("input", "output", "cached"):
            result[key] = str(Decimal(result[key]) * 2)
    if provider == "openai" and model in {
        "gpt-6-astra",
        "gpt-6.1-sol",
        "gpt-6-sol",
        "gpt-6-luna",
        "gpt-5.6",
        "gpt-5.6-sol",
        "gpt-5.6-terra",
        "gpt-5.6-luna",
        "gpt-5.5",
        "gpt-5.4",
    }:
        result["long_context"] = {"threshold": 272000, "input_factor": "2", "output_factor": "1.5"}
    if provider == "google" and model == "gemini-2.5-pro":
        result["long_context"] = {"threshold": 200000, "input_factor": "2", "output_factor": "1.5"}
    if provider == "anthropic" and model == "claude-haiku-5-5":
        result["long_context"] = {"threshold": 100000, "input_factor": "5", "output_factor": "5"}
    return result


def cost(price, usage, *, reserve=False):
    if not price or usage is None:
        return None
    inp, out = usage["input_tokens"], usage["output_tokens"]
    cached = usage.get("cached_tokens", 0)
    write = usage.get("cache_write_tokens", 0)
    hour = usage.get("cache_write_hour_tokens", 0)
    long = price.get("long_context", {})
    multiplier = inp > long.get("threshold", 10**30)
    input_factor = Decimal(long["input_factor"]) if multiplier else Decimal(1)
    output_factor = Decimal(long["output_factor"]) if multiplier else Decimal(1)
    rates = {
        k: Decimal(price.get(k, price["input"]))
        for k in ("input", "cached", "write", "write_hour", "output")
    }
    if reserve:
        # A cache write can cost more than ordinary input. Never assume a cache hit.
        value = inp * max(rates[k] for k in ("input", "write", "write_hour")) * input_factor
    else:
        value = (
            (inp - cached - write) * rates["input"]
            + cached * rates["cached"]
            + (write - hour) * rates["write"]
            + hour * rates["write_hour"]
        ) * input_factor
    return ((value + out * rates["output"] * output_factor) / Decimal(1_000_000)).quantize(
        Decimal("0.00000001")
    )


def normalize(provider, data):
    """Count reasoning once; provider cache fields have different inclusion rules."""
    raw = data.get("usageMetadata" if provider == "google" else "usage")
    if not isinstance(raw, dict):
        return None

    def number(mapping, key, default=0):
        value = mapping.get(key, default)
        if type(value) is not int or not 0 <= value <= 10**12:
            raise ValueError()
        return value

    try:
        if provider == "google":
            inp = number(raw, "promptTokenCount", None) + number(raw, "toolUsePromptTokenCount")
            reasoning = number(raw, "thoughtsTokenCount")
            out = number(raw, "candidatesTokenCount", None) + reasoning
            cached = number(raw, "cachedContentTokenCount")
            write = hour = 0
        elif provider == "anthropic":
            cached = number(raw, "cache_read_input_tokens")
            write = number(raw, "cache_creation_input_tokens")
            hour = number(raw.get("cache_creation") or {}, "ephemeral_1h_input_tokens")
            inp = number(raw, "input_tokens", None) + cached + write
            out = number(raw, "output_tokens", None)
            reasoning = 0
        else:
            chat = provider == "zai"
            inp = number(raw, "prompt_tokens" if chat else "input_tokens", None)
            out = number(raw, "completion_tokens" if chat else "output_tokens", None)
            details = raw.get("prompt_tokens_details" if chat else "input_tokens_details") or {}
            cached = number(details, "cached_tokens")
            write = number(details, "cache_write_tokens")
            reasoning = number(
                raw.get("completion_tokens_details" if chat else "output_tokens_details") or {},
                "reasoning_tokens",
            )
            hour = 0
        if cached + write > inp or hour > write or reasoning > out:
            return None
        return dict(
            input_tokens=inp,
            output_tokens=out,
            cached_tokens=cached,
            cache_write_tokens=write,
            cache_write_hour_tokens=hour,
            reasoning_tokens=reasoning,
        )
    except (ValueError, TypeError, AttributeError):
        return None
