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
  --max-calls 20 --output output/aso-eval/first-run
```

`openai`, `google` and `anthropic` use their existing encrypted connections. No key
belongs in command arguments or reports. Any installation can run the suite with
its own workspace and models; no project owner's account is assumed. This is a
maintainer command with server access, not a web endpoint exposed to members.

Use `--case vague-subtitle --case payment-qualifications` to select cases, and
`--repeat 3` to observe variability. The planned case count multiplied by repeats
and **two calls per case** must fit `--max-calls` before any request starts. Up to
five repeats and fifty calls are allowed. The production caps are 12,000 tokens
for copy review and 8,000 for evidence review. The second call is skipped if no
candidate survives structural validation. This is a token/request bound,
**not a currency budget**. Provider billing
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
the dataset, prompt/schema/guidance fingerprint, knowledge version and rule version. Expectations
and review notes are never included in the model context.
The first response is checkpointed before evidence review. If that second call
fails or times out, the original copy and the failed stage remain inspectable,
but no unchecked report is treated as complete. Evidence review responses and
usage appear separately in both JSON and HTML.

Open `report.html` locally to compare imported copy, observations and proposals.
It has no JavaScript or external resource loading and escapes model output.
Artifacts under `output/` are ignored by Git. Publishing a result is a separate
maintainer decision; no report is uploaded automatically.

## What the results mean

An automated pass means only that this attempt met its specified expectations:

- Every imported field has a structurally validated review.
- The separate evidence reviewer has accepted every delivered observation and
  proposal; filtered claims remain evaluation failures, not hidden successes.
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
does not satisfy independent human review. The production evidence reviewer is
a separate call to the same model, and can itself make mistakes. It is not an
independent evaluator of overall ASO quality. Expert calibration, representative consented real cases and
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
| Ten fresh cases, prompt `apple-editorial-2026-10-17.2`, knowledge `aso-knowledge-2026-10-17.1`, suite v2 | 10/10 | Scoped citations and the expanded library passed structural checks; semantic problems remain below. |

The initial run correctly abstained on unavailable fields and removed the injected
reviewer instructions. It also described on-device storage as an offline privacy
qualification in one rationale, without evidence of offline operation. The revised
prompt explicitly separates those concepts; this inference did not recur in the
four follow-up attempts. One follow-up description redundantly repeats its feature
list despite meeting automated expectations. That remains an editorial review
finding.

The fresh full run with the expanded library used all five reference IDs across
its responses. It retained clear copy, proposed concrete replacements for targeted
weaknesses, preserved the French listing language and removed the injected block.
No citation was rejected for its field or store scope. However, one rationale
called local notes without an account an "offline" capability, which the imported
text does not establish; another called listing claims "verified product features"
without testing the product. These assistant-observed semantic errors pass the
automated checks. They remain findings for independent review, not hidden by the
10/10 structural result. These samples do not establish model superiority or
reliable semantic accuracy.

## Evidence-review regressions

The seven fixed cases in `grounding_cases.json` isolate the two observed errors
and controls: unjustified offline operation, false product verification, faithful
account scope, explicit uncertainty, an explicitly documented offline capability,
overstating that capability to network-dependent features, and describing a feature
without claiming it was tested. Labels are project judgments recorded by the
assistant, not independent expert calibration. They are never sent to the reviewer.

```sh
# Offline: list the case count. No credentials or requests.
.venv/bin/python manage.py evaluate_aso_grounding

# Explicit live check: seven bounded calls using the production reviewer.
.venv/bin/python -u manage.py evaluate_aso_grounding \
  --live --workspace WORKSPACE_UUID --provider google --model MODEL_ID \
  --max-calls 7 --output output/aso-eval/evidence-regressions
```

The directory must be new. Private JSON records preserve context, verdicts,
quoted problematic text, usage and completed/failed/unattempted cases. Provider
errors stop the run without automatic retries. An interrupted call remains in
progress and may already have been billed. CI tests make no paid requests.

On October 17, 2026, `gemini-3.8-flash` with `aso-grounding-2026-10-17.1` and a
fresh run with `aso-grounding-2026-10-17.2` each produced
all seven expected verdicts: both original errors were rejected, the qualified
positive/abstention controls accepted, and the overbroad offline claim rejected.
This is a small regression result, not a universal hallucination guarantee.

The full pipeline with writer `apple-editorial-2026-10-17.3` and reviewer `.1`
completed ten distinct cases across two runs: nine met expectations; one exposed
a reviewer false rejection. Its context omitted the local keyword cleanup that
the writer correctly referenced. Reviewer `.2` now receives those same rule
findings, excluding generated suggestions so they cannot justify themselves.
A single new review of the exact saved response now accepts its five observations
and meets this case's expectations. This isolates the context fix; it is not a
fresh ten-case writing run.
Two attempts timed out at Gemini (one during review, one during a later writing
call); both stopped without automatic retries or publishing unchecked results.
The saved partial/error records remain separate from completed results.

A new MonTri audit was also exercised through the browser with reviewer `.2`:
all six workflow steps completed, five field observations and one keyword proposal
were reviewed, and the two calls' usage appeared separately. This exercises the
real UI and worker path; it does not measure changes in installs or independently
verify the app's features.

The implementation also follows the distinction between structured output and
semantic validation in [Google's structured output documentation](https://ai.google.dev/gemini-api/docs/generate-content/structured-output?hl=en),
and combining deterministic checks with a separately calibrated evidence reviewer
in [OpenAI's grounding evaluation example](https://developers.openai.com/cookbook/examples/agent_optimization/optimizing_agents_for_cost_and_quality#optional-judge-customer-answer-completeness-and-grounding).

## References

The cases use Apple's guidance on concrete subtitles, readable descriptions,
relevant keywords and field purposes: [Creating your product page](https://developer.apple.com/app-store/product-page/)
and [App Store search](https://developer.apple.com/app-store/search/).
The evaluation method follows the distinction between automated checks and human
calibration in the official [OpenAI evaluation best practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices).
Sources were consulted on October 17, 2026 (UTC). This implementation is local and
provider-independent; it does not depend on OpenAI's hosted Evals platform.
