# AI usage and limits

[Documentation](README.md)

Open **AI usage** in the sidebar to inspect tokens and estimated USD costs for ASO,
SMM and AI connection checks. Filter by month, application, provider or module.
The page groups consumption by application, provider and operation, with individual
requests under **Call details**. Workflow activity also shows its recorded usage.

CLI evaluations using a saved workspace connection also count toward that workspace.

The provider's prepaid account balance is separate. The connected model APIs do
not supply that balance to Panda. Links to provider consoles are available on the
page. For example, a $20 Panda monthly budget with $1 used and nothing reserved
shows $19 remaining in Panda; it does not establish the provider's account balance.
Other applications using the same key are outside this workspace's accounting.

## Set a budget

The workspace owner can set monthly and per-operation limits in USD, tokens, or
both. Only configured limits are enforced; empty fields disable their own limit
independently. For example, a $5 monthly budget with every other field empty checks
only that monthly dollar cap. A zero USD limit allows listed-free models but
blocks calls requiring money; a zero token limit blocks generation. Limits start
disabled. They apply across every application and provider in the workspace.

Each outbound model request reserves an input allowance and the requested maximum
output before it is sent. Recorded usage replaces that reservation when available.
Reservations and budget edits are serialized in the database, including SQLite,
so two workers cannot both spend the same remaining allowance. Monthly limits use
UTC calendar months. Outstanding reservations from earlier months remain included.
The dashboard warns when at least 80% of a monthly limit is used or reserved.

An operation includes its reviews and retries. ASO audits, script generations and
legacy research use the original workflow in the retry chain. Browser SMM planning
and publication analysis share the research session's budget. Starting an entirely
new operation creates a new per-operation budget, while the monthly total continues.
A blocked workflow retains its saved steps; after adjusting a limit, use its normal
retry action. Requests already sent can still complete or be billed after cancellation.

The local reservation is conservative, not a provider tokenizer: it uses UTF-8 byte
length with a protocol allowance, a separate allowance for each image, and the
configured maximum output. It assumes no cache discount and allows for cache writes
and published long-context prices. Actual usage can differ. These controls govern
Panda's next requests against estimates; provider billing controls remain necessary
for account-wide enforcement. Bills, discounts, free quotas, tax, exchange rates
and usage outside Panda are not reconstructed here.

Provider-hosted web search has additional tool fees that cannot always be bounded.
The legacy public-page discovery workflow is therefore blocked when any AI limit
is enabled. Its consumption is still tracked without limits, but total cost is
marked unknown. The normal SMM browser research workflow remains available with limits.
An unlisted model can run without a monetary limit; its cost is unknown, never zero.
It cannot run under a monetary limit until a reviewed price is added.

## Missing usage

Counters are captured at the HTTP boundary, before JSON content validation. A
rejected, incomplete or unusable answer still counts when the provider supplies
usage. Each retry is a separate request. Cached input and reasoning are not added
twice: Gemini's visible and thinking output are combined; OpenAI reasoning is
already included in output. Anthropic cache input is added to its uncached input.

A timeout, lost response or worker crash leaves an unresolved reservation. A price
that is unavailable also remains unknown. Unknown costs from live tracking can
prevent further calls under a monetary cap. Completed calls recovered from before
tracking began are partial history: their missing prices remain unknown and visible,
but do not block new calls. Known historical costs and all unresolved reservations
still count toward configured limits. The remaining budget is marked as a partial
estimate when historical prices are missing; those missing charges are not included.
Under **Call details**, the owner may reconcile an unresolved
request after checking that specific request with the provider. The adjustment
records its author and time. Live calls cannot be reconciled; stale pending calls
must outlive the request deadline and their workflow must have stopped.

Usage records store request attribution, numeric counters and the price used.
They do not store prompts, generated text, API keys or screenshots. Every read and
write is scoped to the authenticated workspace. Only its owner can edit limits or
reconcile unknown amounts.

## Upgrade an existing installation

Apply migrations and restart backend and workers using the installation's normal
upgrade procedure. Recover surviving earlier counters once with:

```sh
.venv/bin/python manage.py backfill_ai_usage
```

The command makes no provider requests and is safe to repeat. It skips reused
workflow checkpoints and operations already tracked live. It imports surviving
ASO, SMM script, legacy research and browser research counters, with their original
dates. This is explicitly **partial history**: older failed calls, overwritten
attempts, missing cache details and missing reasoning counters cannot always be
reconstructed. Historical prices use the reviewed catalogue, not past invoices.

## Reviewed prices

`panda_store/ai/pricing.py` contains standard paid API prices, verified on
2026-10-19. Every request freezes its price snapshot. Review the catalogue against
these official sources before adding models or changing rates:

| Provider | Source |
| --- | --- |
| OpenAI | [API pricing](https://developers.openai.com/api/docs/pricing) |
| Google | [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Anthropic | [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| Z.ai | [GLM pricing](https://docs.z.ai/guides/overview/pricing) |

Known future Gemini price changes are dated in the catalogue. When a promotion
expires without a verified successor price, that model becomes unpriced. A model
ID not explicitly reviewed is unpriced. Nonstandard processing tiers are also
unpriced. This page does not read provider billing using administrative keys.

For provider-side reporting, see OpenAI's [Costs API](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs),
Anthropic's [Usage and Cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api),
and Google's [billing guide](https://ai.google.dev/gemini-api/docs/billing).
They have different authorization and reporting semantics; cost reports do not
establish the remaining prepaid balance.
