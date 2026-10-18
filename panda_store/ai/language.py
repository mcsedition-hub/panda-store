"""Keep explanatory prose separate from the language of publishable content."""


def language_name(language):
    return "Français" if language == "fr" else "English"


def response_instruction(instruction, language="en"):
    # Only the saved account preference can select a language, never arbitrary prompt text.
    name = "French (fr)" if language == "fr" else "English (en)"
    return (
        instruction
        + f"""

Response language: {name}.
Write user-facing explanations, observations, recommendations, rationales, report titles,
angles, adaptation explanations, strategies, limitations and review reasons in this response
language, even when the listing, sources or previous analyses use a different language.
Keep JSON keys, enum values, IDs, URLs, app names and other technical identifiers unchanged.
Preserve evidence quotes, hook_quote, fact_quote, unsupported_quote and visible caption excerpts
verbatim in their original language. Do not translate evidence to match the response language.
Proposed store listing replacements and screenshot captions must use the listing's locale.
Publishable marketing copy (hooks, scripts, spoken lines, on-screen text and calls to action)
must use the explicitly selected brief.language; if none is supplied, use the response language.
Search queries must still match the requested market. These content-language rules are distinct
from the response language used for your explanations. Keep the requested output schema intact.
"""
    )
