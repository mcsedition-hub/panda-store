# Evaluating ASO recommendations

Panda Store includes a small, versioned evaluation suite for its Apple editorial
review. It exercises the same context builder, instructions, schema, provider
adapter and validator as a real audit. It does not publish listings or create
apps, audits, drafts or workflows in the installation database.

The ten original synthetic listings cover clear copy, vague praise, buried
features, irrelevant keywords, missing imports, an empty optional field, French,
payment/account qualifications, prompt injection and repetition already handled
by local checks. They contain no customer data. Their expected outcomes are
provisional project judgments, not labels calibrated by independent ASO experts.

## Offline checks

List the cases without credentials or provider calls:

```sh
.venv/bin/python manage.py evaluate_aso
```

Run the evaluator's regression tests:

```sh
.venv/bin/pytest tests/test_aso_evaluation.py
```

GitHub's existing backend check runs these tests on every push and pull request.
They deliberately submit flawed responses to verify that missed defects, rejected
sources, omitted payment terms, unwanted rewrites and injected instructions are
visible as failures. They do **not** run a real model or measure its quality.
CI requires no API key and makes no paid evaluation requests.

## Live evaluation

Connect a provider in the installation's AI settings first. Use an explicit
workspace UUID, provider and model from that connection's current catalog:

```sh
.venv/bin/python -u manage.py evaluate_aso \
  --live --workspace WORKSPACE_UUID \
  --provider google --model MODEL_ID \
  --max-calls 10 --output output/aso-eval/first-run
```

`openai`, `google` and `anthropic` use their existing encrypted connections. No key
belongs in command arguments or reports. Any installation can run the suite with
its own workspace and models; no project owner's account is assumed. This is a
maintainer command with server access, not a web endpoint exposed to members.

Use `--case vague-subtitle --case payment-qualifications` to select cases, and
`--repeat 3` to observe variability. The planned case count multiplied by repeats
must fit `--max-calls` before any request starts. Up to five repeats and fifty
calls are allowed. Each call has the production output cap (currently 12,000
tokens); this is a token/request bound, **not a currency budget**. Provider billing
applies. There are no retries, parallel calls or provider fallbacks.

A provider or credential error stops subsequent requests. Replacing or removing
the connection stops the next request rather than adopting another key silently.
Stopping the command cannot undo a request already sent or its billing.

The output directory must be new. Results are checkpointed after each attempt as
`report.json` and `report.html`, with private file permissions. A checkpoint before
each call marks it in progress: an interruption leaves that attempt unfinished,
not falsely unsent. Remaining attempts stay not run. Each row retains its synthetic
inputs, actual model context, raw structured response, accepted recommendations,
checks, resolved model, returned token usage and duration. The manifest identifies
the dataset, prompt/schema/guidance fingerprint and rule version. Expectations
and review notes are never included in the model context.

Open `report.html` locally to compare imported copy, observations and proposals.
It has no JavaScript or external resource loading and escapes model output.
Artifacts under `output/` are ignored by Git. Publishing a result is a separate
maintainer decision; no report is uploaded automatically.

## What the results mean

An automated pass means only that this attempt met its specified expectations:

- Every imported field has a structurally validated review.
- The model produced no proposals discarded by the production validator.
- Targeted weak fields received the expected verdict and, where required, a
  usable proposal.
- Changes stayed within the fields targeted by that synthetic case.
- Selected injected/unsupported phrases are absent, and selected qualification
  terms survive in rewritten descriptions.

The last checks are lexical alarms. A paraphrase can be correct despite failing
one; a sentence can contain the required word while contradicting its meaning.
A valid quote or source ID does not establish semantic grounding. The evaluator's
own tests demonstrate that generic observations can pass mechanical checks.
Counts therefore never become an ASO score or a certification of the model.

Every report remains **Human review pending**. Reviewers should record their name,
date, pass/fail/not-applicable for each criterion below, and a specific example:

| Criterion | Review question |
| --- | --- |
| Grounding | Does every proposed claim follow from the actual listing evidence? |
| Usefulness | Is there a concrete weakness, and does the replacement address it? |
| Restraint | Does the review preserve good copy and abstain when evidence is missing? |
| Language | Is the whole replacement natural in the original language? |
| Qualifications | Are payment, privacy, account and support conditions preserved in meaning? |

An assistant's inspection or another model's rating must be labeled as such; it
does not satisfy independent human review. There is no automatic model judge in
this first version. Expert calibration, representative consented real cases and
a held-out set remain future work. Avoid tuning to these ten examples and then
claiming broad quality from the same set. A single run is not a model ranking.
No benchmark result demonstrates increased downloads or conversion.

## Recheck saved responses

```sh
.venv/bin/python manage.py evaluate_aso \
  --replay output/aso-eval/first-run/report.json \
  --output output/aso-eval/rechecked
```

Replay recalculates automated checks without reading credentials or calling a
provider. It rejects changed datasets, inputs, prompts or guidance. Use the
matching code version for an old artifact; run a fresh live evaluation after a
prompt change. A replay is not an independent model run and does not test model
variability. To compare providers or prompt versions, keep separate directories
and compare like cases, repetitions and reported versions.

If review identifies a faulty benchmark expectation, correct the case and bump
the suite version. Replay with `--regrade-reason "Explain the corrected criterion"`
explicitly applies the revised expectations. The imported text, actual model
context and prompt contract must still match exactly. The new report records the
previous manifest, expectations, checks and reason; the original artifact remains
unchanged. This is a correction to the grading, never an improvement in the model.
Version 2 removes a French keyword-presence check: the valid subtitle “Comparez
avant de supprimer” demonstrated why particular words cannot establish language
quality. French naturalness remains a manual criterion.

## Initial development run · October 17, 2026

These observations are an assistant inspection of synthetic cases, not independent
expert calibration. Gemini `gemini-3.8-flash` was used with the configured adapter.

| Run | Automated result | Interpretation |
| --- | --- | --- |
| Ten cases, prompt `apple-editorial-2026-10-16.3`, suite v1 | 9/10 | The French keyword-presence check produced a false positive. |
| Same saved responses, suite v2 | 10/10 | Grading correction only; no new model responses or demonstrated improvement. |
| Two targeted cases, two repetitions each, prompt `apple-editorial-2026-10-17.1` | 4/4 | A narrow follow-up after reinforcing evidence requirements in observations and rationales. |

The initial run correctly abstained on unavailable fields and removed the injected
reviewer instructions. It also described on-device storage as an offline privacy
qualification in one rationale, without evidence of offline operation. The revised
prompt explicitly separates those concepts; this inference did not recur in the
four follow-up attempts. One follow-up description redundantly repeats its feature
list despite meeting automated expectations. That remains an editorial review
finding. The revised prompt has **not** been evaluated on a fresh full suite here,
and these samples do not establish model superiority or reliable semantic accuracy.

## References

The cases use Apple's guidance on concrete subtitles, readable descriptions,
relevant keywords and field purposes: [Creating your product page](https://developer.apple.com/app-store/product-page/)
and [App Store search](https://developer.apple.com/app-store/search/).
The evaluation method follows the distinction between automated checks and human
calibration in the official [OpenAI evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices).
Sources were consulted on October 17, 2026 (UTC). This implementation is local and
provider-independent; it does not depend on OpenAI's hosted Evals platform.
