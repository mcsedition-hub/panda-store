"""Z.ai's standard API. Model capabilities/pricing reviewed on 2026-10-18.

https://docs.z.ai/api-reference/llm/chat-completion
https://docs.z.ai/guides/capabilities/struct-output
https://docs.z.ai/guides/vlm/glm-4.6v
https://docs.z.ai/guides/overview/pricing

The documented API does not provide account model discovery. Keep this supported
catalog explicit and verify the key using only the listed-free text model.
"""

import json

from jsonschema import Draft202012Validator

from .errors import ProviderError

MODELS = {
    "glm-4.7-flash": {"vision": False, "listed_free": True},
    "glm-4.6v-flash": {"vision": True, "listed_free": True},
    "glm-4.5-flash": {"vision": False, "listed_free": True},
    "glm-5.3": {"vision": False, "listed_free": False},
    "glm-5.2": {"vision": False, "listed_free": False},
    "glm-5.1": {"vision": False, "listed_free": False},
    "glm-5": {"vision": False, "listed_free": False},
    "glm-4.7": {"vision": False, "listed_free": False},
    "glm-4.6": {"vision": False, "listed_free": False},
    "glm-4.6v": {"vision": True, "listed_free": False},
    "glm-4.6v-flashx": {"vision": True, "listed_free": False},
}
CHECK_MODEL = "glm-4.7-flash"


def completion(data):
    choices = data.get("choices")
    if not isinstance(choices, list) or len(choices) != 1 or not isinstance(choices[0], dict):
        raise ProviderError("Z.ai did not return a complete response. Try again later.")
    choice = choices[0]
    reason = choice.get("finish_reason")
    if reason == "sensitive":
        raise ProviderError(
            "Z.ai declined this content. Review the supplied content before starting a new task.",
            code="content_blocked",
        )
    if reason in {"length", "model_context_window_exceeded"}:
        raise ProviderError(
            "Z.ai reached its input or output limit. No incomplete results were saved. "
            "Choose another model or reduce the content and start a new task.",
            code="output_limit",
        )
    message = choice.get("message")
    if (
        reason != "stop"
        or not isinstance(message, dict)
        or message.get("tool_calls")
        or not isinstance(message.get("content"), str)
        or not message["content"].strip()
    ):
        raise ProviderError("Z.ai did not finish its response. Retry or choose another model.")
    return message["content"].strip()


def catalog(request, key):
    # No app data, provider switch or automatic retry in this connection check.
    data = request(
        "zai",
        key,
        "/chat/completions",
        payload={
            "model": CHECK_MODEL,
            "messages": [{"role": "user", "content": "Reply with OK."}],
            "thinking": {"type": "disabled"},
            "max_tokens": 16,
            "stream": False,
        },
    )
    completion(data)
    return [{"id": model, "name": model, **capabilities} for model, capabilities in MODELS.items()]


def generate(request, key, model, instruction, context, schema, max_output_tokens, images):
    vision = MODELS[model]["vision"]
    content = [{"type": "text", "text": json.dumps(context, ensure_ascii=False)}]
    for image in images:
        content.extend(
            [
                {"type": "text", "text": f"Screenshot ID: {image['id']}"},
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:{image['mime_type']};base64,{image['data']}",
                    },
                },
            ]
        )
    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": instruction + "\nReturn only one JSON object matching this JSON Schema. "
                "Do not include markdown or commentary:\n" + json.dumps(schema, ensure_ascii=False),
            },
            {"role": "user", "content": content if images else content[0]["text"]},
        ],
        "max_tokens": max_output_tokens,
        "stream": False,
    }
    # Z.ai documents response_format for text models only. Vision responses still
    # have to pass the same local JSON Schema validation before reaching a task.
    if not vision:
        payload["response_format"] = {"type": "json_object"}
    if model == "glm-5.3":
        payload["thinking"] = {"type": "enabled"}
        payload["reasoning_effort"] = "low"
    else:
        payload["thinking"] = {"type": "disabled"}
    data = request("zai", key, "/chat/completions", payload=payload)
    raw = completion(data)
    # Accept one fenced object, never extract JSON from mixed prose.
    if raw.startswith("```json\n") and raw.endswith("\n```"):
        raw = raw[8:-4]
    try:
        result = json.loads(raw)
        if not isinstance(result, dict) or not Draft202012Validator(schema).is_valid(result):
            raise ValueError()
    except (ValueError, TypeError):
        raise ProviderError(
            "Z.ai returned an invalid structured result. Nothing was saved. "
            "Retry or choose another model.",
            code="invalid_output",
        ) from None
    usage = data.get("usage") or {}
    return {
        "result": result,
        "provider": "zai",
        "model": model,
        "resolved_model": data.get("model", model),
        "usage": {
            "input_tokens": usage.get("prompt_tokens"),
            "output_tokens": usage.get("completion_tokens"),
        },
    }
