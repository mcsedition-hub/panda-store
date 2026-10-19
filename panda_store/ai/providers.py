"""Official endpoints only. No credentials or raw provider failures reach logs/UI."""

import asyncio
import json
import re

import httpx
from django.conf import settings

from . import zai
from .context import project_instruction
from .errors import ProviderError, failure
from .language import response_instruction

PROVIDERS = {
    "openai": "OpenAI",
    "google": "Google Gemini",
    "anthropic": "Anthropic Claude",
    "zai": "Z.ai (GLM)",
}
HOSTS = {
    "openai": "https://api.openai.com/v1",
    "google": "https://generativelanguage.googleapis.com/v1beta",
    "anthropic": "https://api.anthropic.com/v1",
    "zai": "https://api.z.ai/api/paas/v4",
}


async def _request(provider, key, path, payload, params, deadline):
    """Bound the entire exchange, including a slow first byte or a stalled body."""
    headers = (
        {"Authorization": f"Bearer {key}"}
        if provider in {"openai", "zai"}
        else (
            {"x-goog-api-key": key}
            if provider == "google"
            else {"x-api-key": key, "anthropic-version": "2023-06-01"}
        )
    )
    # HTTPX read timeouts measure inactivity, not total duration. The outer deadline
    # also cancels a provider that keeps sending small chunks indefinitely.
    timeout = httpx.Timeout(deadline if payload is not None else 70, connect=10, write=30, pool=10)
    async with asyncio.timeout(deadline):
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            async with client.stream(
                "POST" if payload is not None else "GET",
                HOSTS[provider] + path,
                headers=headers,
                json=payload,
                params=params,
            ) as response:
                body = bytearray()
                failed = not 200 <= response.status_code < 300
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if failed and len(body) > 65536:
                        body.clear()
                        break
                    if len(body) > 2_000_000:
                        raise ProviderError("The provider response exceeded the size limit.")
                if failed:
                    try:
                        data = json.loads(body)
                    except ValueError:
                        data = {}
                    raise failure(
                        provider, response.status_code, data, response.headers.get("retry-after")
                    )
    return body


def request(provider, key, path, *, payload=None, params=None):
    from .usage import metered_request

    return metered_request(
        provider,
        path,
        payload,
        lambda: _transport(provider, key, path, payload=payload, params=params),
    )


def _transport(provider, key, path, *, payload=None, params=None):
    # Synchronous entry point for Django views and workers; no database work is
    # performed on the temporary event loop. Catalog requests retain a short budget.
    deadline = settings.PANDA_AI_TIMEOUT_SECONDS if payload is not None else 90
    try:
        body = asyncio.run(_request(provider, key, path, payload, params, deadline))
        data = json.loads(body)
        if not isinstance(data, dict):
            raise ValueError()
        return data
    except (TimeoutError, httpx.TimeoutException):
        raise ProviderError(
            f"{PROVIDERS[provider]}: The request timed out "
            f"(request limit: {deadline:g}s). It may still be processed or billed. "
            "Check provider status before retrying.",
            code="timeout",
        ) from None
    except httpx.HTTPError:
        raise ProviderError(
            "Cannot reach the AI provider. Check your server's network connection "
            "and provider status before retrying.",
            code="network",
        ) from None
    except (ValueError, KeyError):
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
    if provider == "zai":
        return model in zai.MODELS
    return provider == "anthropic" and model.startswith("claude-")


def check_capabilities(provider, model, *, images=False, web_search=False):
    if not supported(provider, model):
        raise ProviderError("Choose a supported AI model.")
    if provider == "zai":
        if web_search:
            raise ProviderError(
                "Z.ai is available in SMM browser research. Legacy web discovery "
                "does not support this provider. Use browser research instead."
            )
        if images and not zai.MODELS[model]["vision"]:
            raise ProviderError(
                "This GLM model only accepts text. Choose a vision model such as "
                "glm-4.6v-flash for screenshots and browser research."
            )


def list_models(provider, key):
    if provider == "zai":
        return zai.catalog(request, key)
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
            if provider == "google":
                # Missing capability metadata is unknown, not evidence of reasoning support.
                thinking = item.get("thinking")
                found[model]["thinking"] = thinking if isinstance(thinking, bool) else None
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


def generate(
    provider,
    key,
    model,
    instruction,
    context,
    schema,
    *,
    max_output_tokens=6000,
    images=None,
    output_name="listing_review",
    response_language="en",
):
    check_capabilities(provider, model, images=bool(images))
    instruction = response_instruction(project_instruction(instruction, context), response_language)
    if provider == "zai":
        return zai.generate(
            request, key, model, instruction, context, schema, max_output_tokens, images or []
        )
    text = json.dumps(context, ensure_ascii=False)
    images = images or []
    openai_content = [{"type": "input_text", "text": text}]
    google_content = [{"text": text}]
    claude_content = [{"type": "text", "text": text}]
    for image in images:
        label = f"Screenshot ID: {image['id']}"
        openai_content.extend(
            [
                {"type": "input_text", "text": label},
                {
                    "type": "input_image",
                    "image_url": f"data:{image['mime_type']};base64,{image['data']}",
                    "detail": "high",
                },
            ]
        )
        google_content.extend(
            [
                {"text": label},
                {"inlineData": {"mimeType": image["mime_type"], "data": image["data"]}},
            ]
        )
        claude_content.extend(
            [
                {"type": "text", "text": label},
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": image["mime_type"],
                        "data": image["data"],
                    },
                },
            ]
        )
    if provider == "openai":
        data = request(
            provider,
            key,
            "/responses",
            payload={
                "model": model,
                "store": False,
                "instructions": instruction,
                "input": [{"role": "user", "content": openai_content}] if images else text,
                "max_output_tokens": max_output_tokens,
                "text": {
                    "format": {
                        "type": "json_schema",
                        "name": output_name,
                        "strict": True,
                        "schema": schema,
                    }
                },
            },
        )
        if data.get("status") != "completed":
            if (data.get("incomplete_details") or {}).get("reason") == "max_output_tokens":
                raise ProviderError(
                    "The model reached its output limit before finishing. No incomplete "
                    "recommendations were saved. Choose another model and start a new audit.",
                    code="output_limit",
                )
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
        if any(
            part.get("type") == "refusal"
            for item in data.get("output", [])
            if item.get("type") == "message"
            for part in item.get("content", [])
        ):
            raise ProviderError(
                "The model declined to analyze this content. Review the supplied listing "
                "before starting a new audit.",
                code="content_blocked",
            )
        usage = data.get("usage", {})
        usage = {
            "input_tokens": usage.get("input_tokens"),
            "output_tokens": usage.get("output_tokens"),
        }
        resolved = data.get("model", model)
    elif provider == "google":
        generation_config = {
            "maxOutputTokens": max_output_tokens,
            "responseMimeType": "application/json",
            "responseJsonSchema": schema,
        }
        # Reviewed against Google's thinking guide on 2026-10-16. Gemini 4 requires
        # a level; medium is the documented default for both suggested ASO models.
        # Do not send this to 2.5, which uses thinkingBudget instead.
        if model in {"gemini-4-argon", "gemini-3.8-flash"}:
            generation_config["thinkingConfig"] = {"thinkingLevel": "medium"}
        data = request(
            provider,
            key,
            f"/models/{model}:generateContent",
            payload={
                "systemInstruction": {"parts": [{"text": instruction}]},
                "contents": [{"role": "user", "parts": google_content}],
                "generationConfig": generation_config,
            },
        )
        candidates = data.get("candidates", [])
        if data.get("promptFeedback", {}).get("blockReason") or (
            candidates
            and candidates[0].get("finishReason")
            in {"SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"}
        ):
            raise ProviderError(
                "Gemini blocked this analysis under its content rules. Review the listing "
                "before starting a new audit.",
                code="content_blocked",
            )
        if not candidates or candidates[0].get("finishReason") != "STOP":
            raise ProviderError(
                "The model did not finish its analysis. It may have reached its output limit. "
                "No incomplete recommendations were saved. Choose another model and "
                "start a new audit.",
                code="incomplete_output",
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
                "max_tokens": max_output_tokens,
                "system": instruction,
                "messages": [{"role": "user", "content": claude_content if images else text}],
                "tools": [
                    {
                        "name": output_name,
                        "description": "Return the requested structured analysis for human review.",
                        "input_schema": schema,
                    }
                ],
                "tool_choice": {"type": "tool", "name": output_name},
            },
        )
        outputs = [
            item["input"]
            for item in data.get("content", [])
            if item.get("type") == "tool_use" and item.get("name") == output_name
        ]
        if data.get("stop_reason") == "refusal":
            raise ProviderError(
                "Claude declined to analyze this content. Review the listing before "
                "starting a new audit.",
                code="content_blocked",
            )
        if data.get("stop_reason") == "max_tokens":
            raise ProviderError(
                "Claude reached its output limit. No incomplete recommendations were "
                "saved. Choose another model and start a new audit.",
                code="output_limit",
            )
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
