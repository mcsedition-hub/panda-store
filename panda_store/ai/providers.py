"""Official endpoints only. No credentials or raw provider failures reach logs/UI."""

import json
import re
import time

import httpx

PROVIDERS = {"openai": "OpenAI", "google": "Google Gemini", "anthropic": "Anthropic Claude"}
HOSTS = {
    "openai": "https://api.openai.com/v1",
    "google": "https://generativelanguage.googleapis.com/v1beta",
    "anthropic": "https://api.anthropic.com/v1",
}


class ProviderError(Exception):
    pass


def request(provider, key, path, *, payload=None, params=None):
    headers = (
        {"Authorization": f"Bearer {key}"}
        if provider == "openai"
        else (
            {"x-goog-api-key": key}
            if provider == "google"
            else {"x-api-key": key, "anthropic-version": "2023-06-01"}
        )
    )
    started = time.monotonic()
    try:
        with httpx.Client(timeout=httpx.Timeout(70, connect=10), follow_redirects=False) as client:
            with client.stream(
                "POST" if payload is not None else "GET",
                HOSTS[provider] + path,
                headers=headers,
                json=payload,
                params=params,
            ) as response:
                if response.status_code in {401, 403}:
                    raise ProviderError(
                        "The provider rejected this key or access. Check AI settings."
                    )
                if response.status_code == 429:
                    raise ProviderError(
                        "The provider's quota or rate limit was reached. Check billing "
                        "and retry later."
                    )
                if not 200 <= response.status_code < 300:
                    raise ProviderError(
                        f"Provider request failed (HTTP {response.status_code}). "
                        "Check model access or retry later."
                    )
                body = bytearray()
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > 2_000_000 or time.monotonic() - started > 90:
                        raise ProviderError(
                            "The provider response exceeded the time or size limit."
                        )
        return json.loads(body)
    except (httpx.HTTPError, ValueError, KeyError):
        raise ProviderError(
            "The provider returned an unreadable response or could not be reached. Retry later."
        ) from None


def supported(provider, model):
    if not re.fullmatch(r"[a-zA-Z0-9._-]{1,120}", model):
        return False
    if provider == "openai":
        if model == "gpt-4o-2024-05-13" or "chat-latest" in model:
            return False
        return bool(re.match(r"gpt-(?:4o|4\.1|5|6)(?:[-.]|$)", model)) and not any(
            word in model
            for word in (
                "audio",
                "realtime",
                "transcribe",
                "tts",
                "image",
                "search",
                "codex",
                "computer",
                "pro",
                "deep-research",
            )
        )
    if provider == "google":
        return bool(re.match(r"gemini-(?:[2-9]|[1-9][0-9]+|pro-|flash-)", model)) and not any(
            word in model
            for word in (
                "image",
                "transcribe",
                "audio",
                "tts",
                "live",
                "robotics",
                "embedding",
                "computer",
                "research",
            )
        )
    return model.startswith("claude-")


def list_models(provider, key):
    found, cursor = {}, None
    for _ in range(10):
        params = (
            {"pageSize": 100}
            if provider == "google"
            else {"limit": 100}
            if provider == "anthropic"
            else {}
        )
        if cursor:
            params["pageToken" if provider == "google" else "after_id"] = cursor
        data = request(provider, key, "/models", params=params)
        for item in data.get("models" if provider == "google" else "data", []):
            model = (
                item.get("name", "").removeprefix("models/")
                if provider == "google"
                else item.get("id", "")
            )
            if not supported(provider, model):
                continue
            if provider == "google" and "generateContent" not in item.get(
                "supportedGenerationMethods", []
            ):
                continue
            if (
                provider == "anthropic"
                and item.get("capabilities", {}).get("structured_outputs", {}).get("supported")
                is False
            ):
                continue
            found[model] = {
                "id": model,
                "name": item.get("displayName") or item.get("display_name") or model,
            }
        cursor = (
            data.get("nextPageToken")
            if provider == "google"
            else data.get("last_id")
            if provider == "anthropic" and data.get("has_more")
            else None
        )
        if not cursor:
            break
    if not found:
        raise ProviderError("No supported text models were returned for this key.")
    return sorted(found.values(), key=lambda item: item["id"], reverse=True)


def generate(provider, key, model, instruction, context, schema):
    if not supported(provider, model):
        raise ProviderError("This model is not supported for listing analysis.")
    text = json.dumps(context, ensure_ascii=False)
    if provider == "openai":
        data = request(
            provider,
            key,
            "/responses",
            payload={
                "model": model,
                "store": False,
                "instructions": instruction,
                "input": text,
                "max_output_tokens": 6000,
                "text": {
                    "format": {
                        "type": "json_schema",
                        "name": "listing_review",
                        "strict": True,
                        "schema": schema,
                    }
                },
            },
        )
        if data.get("status") != "completed":
            raise ProviderError(
                "The model did not finish its analysis. Choose another model or retry."
            )
        raw = "".join(
            part.get("text", "")
            for item in data.get("output", [])
            if item.get("type") == "message"
            for part in item.get("content", [])
            if part.get("type") == "output_text"
        )
        usage = data.get("usage", {})
        usage = {
            "input_tokens": usage.get("input_tokens"),
            "output_tokens": usage.get("output_tokens"),
        }
        resolved = data.get("model", model)
    elif provider == "google":
        data = request(
            provider,
            key,
            f"/models/{model}:generateContent",
            payload={
                "systemInstruction": {"parts": [{"text": instruction}]},
                "contents": [{"role": "user", "parts": [{"text": text}]}],
                "generationConfig": {
                    "maxOutputTokens": 6000,
                    "responseMimeType": "application/json",
                    "responseJsonSchema": schema,
                },
            },
        )
        candidates = data.get("candidates", [])
        if not candidates or candidates[0].get("finishReason") != "STOP":
            raise ProviderError(
                "The model did not finish its analysis. Choose another model or retry."
            )
        raw = "".join(
            part.get("text", "")
            for part in candidates[0].get("content", {}).get("parts", [])
            if not part.get("thought")
        )
        usage = data.get("usageMetadata", {})
        usage = {
            "input_tokens": usage.get("promptTokenCount"),
            "output_tokens": usage.get("candidatesTokenCount"),
            "reasoning_tokens": usage.get("thoughtsTokenCount"),
        }
        resolved = data.get("modelVersion", model)
    else:
        data = request(
            provider,
            key,
            "/messages",
            payload={
                "model": model,
                "max_tokens": 6000,
                "system": instruction,
                "messages": [{"role": "user", "content": text}],
                "tools": [
                    {
                        "name": "listing_review",
                        "description": "Return a listing review for human approval.",
                        "input_schema": schema,
                    }
                ],
                "tool_choice": {"type": "tool", "name": "listing_review"},
            },
        )
        outputs = [
            item["input"]
            for item in data.get("content", [])
            if item.get("type") == "tool_use" and item.get("name") == "listing_review"
        ]
        if data.get("stop_reason") != "tool_use" or len(outputs) != 1:
            raise ProviderError(
                "The model did not finish its analysis. Choose another model or retry."
            )
        raw = json.dumps(outputs[0])
        usage = data.get("usage", {})
        usage = {
            "input_tokens": usage.get("input_tokens"),
            "output_tokens": usage.get("output_tokens"),
        }
        resolved = data.get("model", model)
    try:
        result = json.loads(raw)
        if not isinstance(result, dict):
            raise ValueError()
    except (ValueError, TypeError):
        raise ProviderError(
            "The model did not return a usable structured analysis. Retry or choose another model."
        ) from None
    return {
        "result": result,
        "provider": provider,
        "model": model,
        "resolved_model": resolved,
        "usage": usage,
    }
