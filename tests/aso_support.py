"""Protocol fixtures only; these permissive mock verdicts do not test model quality."""

import copy

from addons.aso import grounding


def supported_review(context):
    return {
        "result": {
            "reviews": [
                {
                    "id": item["id"],
                    "verdict": "supported",
                    "reason": "Synthetic test verdict.",
                    "unsupported_quote": "",
                }
                for item in context["candidates"]
            ]
        },
        "provider": "google",
        "model": "test-model",
        "resolved_model": "test-model",
        "usage": {"input_tokens": 80, "output_tokens": 40},
        "version": grounding.VERSION,
        "context_sha256": grounding.fingerprint(context),
    }


def provider(copy_output):
    def generate(_provider, _key, _model, instruction, context, _schema, **_options):
        if instruction == grounding.INSTRUCTION:
            return supported_review(context)
        return copy.deepcopy(copy_output)

    return generate
