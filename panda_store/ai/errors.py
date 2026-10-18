"""Translate bounded provider responses into fixed, actionable messages; never echo them."""

from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from math import ceil


class ProviderError(Exception):
    def __init__(self, message, *, code="provider_error"):
        super().__init__(message)
        self.code = code


def retry_delay(value):
    try:
        seconds = float(value)
    except (TypeError, ValueError):
        try:
            seconds = (parsedate_to_datetime(value) - datetime.now(UTC)).total_seconds()
        except (TypeError, ValueError, OverflowError):
            return None
    return max(1, ceil(seconds)) if 0 <= seconds <= 86400 else None


def failure(provider, status, data, retry_after=None):
    names = {"openai": "OpenAI", "google": "Gemini", "anthropic": "Claude", "zai": "Z.ai"}
    name = names[provider]
    error = data.get("error", {}) if isinstance(data, dict) else {}
    if not isinstance(error, dict):
        error = {}
    identifiers = {
        value.lower()
        for key in ("code", "type", "status")
        if isinstance(value := error.get(key), str)
    }
    if provider == "google" and isinstance(error.get("details"), list):
        identifiers.update(
            item["reason"].lower()
            for item in error["details"]
            if isinstance(item, dict) and isinstance(item.get("reason"), str)
        )

    def issue(code, message):
        return ProviderError(f"{name}: {message}", code=code)

    if provider == "zai":
        # Z.ai uses numeric business codes, sometimes encoded as strings.
        business_code = str(error.get("code", ""))
        if business_code == "1113":
            return issue(
                "credits_exhausted",
                "The account has insufficient balance or no applicable resource package. "
                "Check Z.ai billing and this model's access before retrying.",
            )
        if business_code == "1005":
            return issue(
                "account_configuration", "Complete the account verification required by Z.ai."
            )
        if business_code == "1315":
            return issue(
                "authentication",
                "This key is restricted to a coding package. Create a Standard API Key "
                "in Z.ai and replace it in AI settings.",
            )
        if business_code in {"1211", "1212", "1221", "1222", "1311"}:
            return issue(
                "model_unavailable",
                "This model or API is unavailable for this key. Check its availability "
                "in Z.ai and start a new task with a supported model.",
            )
        if business_code == "1261":
            return issue("input_too_large", "The input exceeds this model's context limit.")
        if business_code == "1301":
            return issue(
                "content_blocked", "The provider declined this content. Review it before retrying."
            )
        if business_code == "1305":
            return issue(
                "provider_unavailable",
                "The service is temporarily overloaded. Wait before retrying.",
            )
        if business_code == "1302":
            identifiers.add("rate_limit_exceeded")
        if business_code in {
            "1308",
            "1310",
            "1313",
            "1316",
            "1317",
            "1318",
            "1319",
            "1320",
            "1321",
        }:
            identifiers.add("quota_exceeded")

    if "credit_balance_exhausted" in identifiers:
        return issue(
            "credits_exhausted",
            "API credits are exhausted. Add credits in your provider billing settings, then retry.",
        )
    if identifiers & {"project_spend_limit_exceeded", "organization_spend_limit_exceeded"}:
        return issue(
            "spend_limit",
            "The project or organization spending limit was reached. Review the limit in "
            "provider billing settings before retrying.",
        )
    if identifiers & {"organization_usage_limit_exceeded", "quota_exceeded"}:
        return issue(
            "quota_exhausted",
            "The account quota was reached. Check when it resets or request a higher "
            "limit before retrying.",
        )
    if "insufficient_quota" in identifiers:
        return issue(
            "billing_or_quota",
            "Credits or an account limit prevent this request. Check billing and usage "
            "limits before retrying.",
        )
    # Older Claude responses use invalid_request_error for depleted credits/spend caps.
    # Inspect only these known phrases internally; never display the provider message.
    message = error.get("message", "")
    if provider == "anthropic" and status == 400 and isinstance(message, str):
        if "credit balance is too low" in message.lower():
            return issue(
                "credits_exhausted",
                "API credits are exhausted. Add credits in Claude Console, then retry.",
            )
        if "spend limit" in message.lower():
            return issue(
                "spend_limit",
                "The spending limit was reached. Review the limit in Claude Console "
                "before retrying.",
            )
    if status == 402 or identifiers & {"billing_error", "payment_required", "billing_disabled"}:
        return issue(
            "billing_required",
            "Billing or prepaid credits need attention. Check your provider billing "
            "account before retrying.",
        )
    if status == 401 or identifiers & {
        "api_key_invalid",
        "api_key_expired",
        "authentication_error",
    }:
        return issue(
            "authentication", "The API key was rejected. Check or replace it in AI settings."
        )
    if status == 403:
        return issue(
            "permission",
            "Access was denied. Check the key's permissions, project access and region in "
            "your provider account.",
        )
    if status == 404 or identifiers & {"model_not_found", "not_found_error"}:
        return issue(
            "model_unavailable",
            "This model or resource is unavailable. Refresh models in AI settings and "
            "start a new task with an available model.",
        )
    if status == 413 or identifiers & {"context_length_exceeded", "request_too_large"}:
        return issue(
            "input_too_large",
            "The input exceeds this model's limit. Use a model with a larger context or "
            "reduce the supplied content.",
        )
    if status == 429:
        delay = retry_delay(retry_after)
        if delay or identifiers & {"rate_limit_exceeded", "slow_down", "too_many_requests"}:
            wait = f"Wait at least {delay} seconds" if delay else "Wait before trying again"
            return issue(
                "rate_limit", f"Too many requests or tokens. {wait}; reduce concurrent AI tasks."
            )
        return issue(
            "rate_or_quota",
            "A rate or quota limit was reached. Check your provider's usage limits; a "
            "daily or spending cap may require account changes before retrying.",
        )
    if status in {408, 504}:
        return issue(
            "timeout",
            "The request timed out. Check provider status before retrying; the previous "
            "request may still have been processed.",
        )
    if status >= 500:
        return issue(
            "provider_unavailable",
            "The service is temporarily unavailable or overloaded. Wait, check provider "
            "status, then retry.",
        )
    if "failed_precondition" in identifiers:
        return issue(
            "account_configuration",
            "An account prerequisite is missing. Check project billing, region and API "
            "access before retrying.",
        )
    return issue(
        "invalid_request",
        "The provider rejected this request. Check the model's supported features or try "
        "another model; contact your administrator if it persists.",
    )
