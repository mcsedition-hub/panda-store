# ASO

[Documentation](README.md)

Prepare an App Store listing from an idea, or audit an imported listing.
Revisit saved analyses, compare models and turn proposals into editable drafts.

## Audit an App Store listing

ASO is enabled during setup. Choose an imported app and language, then select
**Run audit**. Audits use the selected saved import, not a live store refresh.
Each result retains its inputs, sources and review date, with a persistent activity
log. Running a new audit checks the latest imported snapshot; retrying an interrupted
audit keeps its original inputs and completed checks.

Leaving ASO does not erase an audit. Returning restores the last viewed report,
language and audit type, or the active audit. **History** lists saved audits across
languages. **Refresh audits** reloads saved results without starting another analysis.

**Compare** displays two completed text analyses side by side, including positioning,
field proposals, character counts, rationales and sources. Choose each field from A or B,
then **Create draft from selection** to combine the saved texts without an AI call.
The draft retains the source analysis and model for each selected field. For imported
listings, unselected fields keep analysis A's saved listing. Idea proposals require all
five fields. Different source versions are flagged; different languages or review types
can be compared but cannot be combined. Rejected proposals cannot be selected. Review
the combined copy and keyword repetitions in the draft before using it.

## Prepare a listing from an idea

For an unpublished app, use **My apps → Create a project** and describe the idea,
or paste/import its Markdown document. Then open **ASO**, select an AI model and
choose **Analyze idea and suggest listing**. No subtitle, description or keywords
need to be written first. This App Store preparation works for iOS projects and
projects whose target platform is still undecided.

ASO analyzes the positioning, audience, possible search intents and missing details,
then proposes all five listing fields. Text lengths, project quotes and source scope
are checked before a second model reviews the claims. **Use this listing as a draft**
opens an editable, versioned draft with the whole proposal. Editing and exporting
make no AI calls. Unverified proposals are withheld. Keyword choices are hypotheses;
there is no live keyword-volume or ranking research. The original project and its
saved analysis remain separate from the proposed listing, and nothing is published.
If verification is interrupted, retry reuses the saved writing step.
The proposed fields use present-tense, publication-ready wording based on the described
features, even for an idea. They do not announce a concept or development status. Missing
details stay in the analysis. The Apple promotional text is a short marketing hook, limited
to 170 characters. The app's internal stage and original specification remain unchanged.
If structural validation rejects a proposal, the error identifies the failed field
and rule. The rejected response remains in the private checkpoint; **Retry unfinished
steps** requests a corrected proposal using that feedback, then verifies it. It keeps
the original project, provider and model, and makes no automatic paid retries.

## Edit and export proposals

The initial rules check name, subtitle, description and promotional-text lengths,
the keyword budget, exact keyword repetition and comma spacing. A proposed cleanup
can be copied for review and manual application in App Store Connect. Apple's
conflicting byte/character keyword limits are disclosed; non-ASCII overflow is
flagged for review. Missing fields are not treated as empty store fields.

Use **Add to draft** on a proposal to create a draft with only that change, or
**Drafts → New draft** to start from an imported language. Edit beside the frozen
reference, or switch the comparison to the latest import. Listing drafts autosave and keep
named copies and immutable revisions. Restore creates a new revision; it does not
change Apple or erase history. Concurrent edits return a conflict, keeping the
local text available to copy before reloading. Navigation waits for pending saves.

**Mark ready** is a separate review action, available after required fields and
field limits are resolved. Editing returns the copy to **Draft**. **Copy changes**
and **Export changes** support manual application; exports pin the saved revision.
**Refresh and compare** uses the enabled Apple connection to refresh metadata,
then compares modified fields without overwriting the draft. If Connections is
disabled or the app has no connector, **Compare latest import** only reads the
saved snapshot. Matching values do not establish publication or download impact.

Retained screenshot recommendations have a **Create brief** action. Find these under
**Drafts → Draft type → Screenshot briefs**. The brief keeps the audited image,
observation, source notes and imported listing, and starts with the suggested change.
Specify the screen to capture, an optional caption and an optional test hypothesis.
**Save brief** records a revision; navigating within Panda Store saves pending edits
before leaving and blocks navigation if saving fails. A browser close with unsaved
changes shows its native warning.

**Duplicate** starts a separate draft. **Revision history** lets you read previous
content and restore it as a new draft. **Mark ready for design** requires a saved
change, a screen description and explicit confirmation that product claims were
checked against the app. Editing resets readiness. This status does not mean a
screenshot has been generated, a store experiment has run or Apple has approved it.
**Export brief** downloads a ZIP for the selected saved revision containing
`brief.md`, `brief.json` and the archived `reference.jpg` when available. Creation,
editing and export make no AI calls and never publish to a store.

## Choose an AI model

Open **ASO → Audit → AI settings**. A workspace owner can connect OpenAI, Google
Gemini, Anthropic Claude or Z.ai (GLM) with their own API key. Keys are encrypted in this
installation's database using `PANDA_CREDENTIAL_KEYS`, never returned to the browser
or shared between workspaces. **Refresh models** reloads the provider's catalogue;
text model families are filtered for this integration. Model access, quotas and
endpoint compatibility are still subject to the provider; failures are explicit.
For Z.ai, refreshing checks the connection and reloads Panda Store's supported
catalogue. See [GLM connection and model selection](connections.md#zai-glm).

The shared model guide explains writing, ideas, reasoning, speed and image
analysis for all providers. Each provider shows up to five main models first;
**See more** reveals the remaining catalogue. A **Recommended for ASO** label
explains our starting choice for this module, without selecting it automatically.
**Compare models by use** and each selected model's official source help you
choose without starting an AI call.

Select **AI provider**, **Model** and **Language**, then **Run audit**. The selected
language's imported text is sent to that provider, using its account and billing.
There is no provider fallback or automatic paid retry. **Rules only · No AI** keeps
the original checks available without a key. All four adapters have automated
contract tests; OpenAI and Gemini have also been exercised with live accounts.

Follow the six workflow steps, then read **Content review** below the activity.
Each of the five fields receives an observation, including when no change is
suggested or evidence is missing. Mechanical limits remain under **Apple checks**.
Each AI proposal includes a replacement, rationale, quoted listing evidence and
curated references. **Add to draft** starts a separate editable draft.
The report records the requested/resolved model and token usage, not an estimated
price. Sources and instructions are versioned; the selected connection revision
is frozen. Replacing/removing its key requires a new audit if the AI call has not
completed. Retry reuses a saved model response when available; a lost response can
require a new paid request. Stopping discards a late result but cannot undo usage.

New AI audits use up to **two model calls** with the selected provider/model: copy
review, then **Check claims against listing**. The second call checks observations,
proposal titles, rationales and replacements for unsupported inferences and altered
qualifications. An unsupported or uncertain observation is withheld along with its
proposal; a rejected proposal is never offered for a draft. Missing or incomplete
evidence reviews fail the audit without publishing unchecked copy. Retry reuses
completed writing and validation steps. Each call's token usage is shown separately.
Older reports remain unchanged and identify the missing evidence review.

Each generation has a **300-second total request deadline**, including the wait
for the first response and reading its body. Reasoning models can take longer
than ordinary text responses. Administrators can set `PANDA_AI_TIMEOUT_SECONDS`
in `.env` (30–900 seconds); restart both the backend and worker after changing it.
Celery's ASO task limits allow both model calls plus checkpoint overhead. Model
catalog requests keep their shorter timeout. A timeout names the provider and
request limit; **Retry unfinished steps** preserves completed checkpoints and
may make another billed request for the unfinished step.

Editorial proposals are hypotheses for human review. Validation rejects unknown
sources, citations outside the field/store scope, vendor-only citations,
non-verbatim evidence, repeated proposals, field overflows, new numbers
and changed URLs. It does not prove feature claims, semantic relevance, translation
quality or improved conversion. The separate model review filters semantic errors,
but is not independent app testing or a guarantee of correctness.
Zero AI proposals is a valid result. The current
review uses five guidance annotations from Apple, Phiture, AppTweak and SplitMetrics,
plus three dated public listing examples from Duolingo, Spotify and Tinder.
Apple guidance remains the primary reference; practitioner/vendor methods supplement
it without supplying app metrics or official requirements.
Open **ASO → Sources** to inspect the exact notes saved with the selected audit or
the library for new audits, including field scope, source type, date and limitations.
Each cited reference also exposes its saved annotation under **Guidance used**.
Maintainers extend [the versioned annotations](../addons/aso/knowledge/editorial.json)
through code review and evaluation; adding a link to the broader source catalog
does not automatically include it in AI context. There is no live web research.
Live competitor research, search demand, download measurement, Google Play
audits and publishing are not implemented. No score or growth guarantee is produced.

For images, select **Review → Screenshots**, a provider/model and the imported
language, then **Review screenshots**. This is a separate five-step workflow:
read listing, save images, analyze, check visual evidence, save findings. Up to ten
imported screenshots and the listing text are sent in **two image-capable model
calls**, billed by the selected provider. The review covers message clarity,
visible UI and consistency with the listing, with a saved image and sources beside
each assessment. Unsupported or uncertain assessments are withheld. Provider errors
use the same failure/retry flow as text audits; completed image and model steps are
reused. No image editing or publishing is performed.

The import currently includes screenshots only for the app's primary language.
Missing images and the ten-image cap are disclosed. Import order is **not** verified
storefront order; downloaded images are **not** original upload files. Upload size
compliance, readability on a real phone and conversion are not established by this
review. The verifier is another model call, not a guarantee of visual correctness.
OpenAI, Gemini, Claude and GLM image adapters have contract tests; live visual validation
is recorded in [the evaluation notes](aso-evaluation.md).

Bounded JPEG derivatives are archived privately in the database, together with
dimensions, capture time and SHA-256. Each review stores at most 15 MB of image
data, usually much less. Include these rows in database backups; no shared media
volume is required between the API and worker. Apply migrations and restart both
services when upgrading. Access requires workspace membership and an active ASO module.

The [backing research](../addons/aso/knowledge/visual-research.json) records a browser
review on October 17, 2026 (US App Store, English, iPhone gallery). Selected **text**
observations now supplement reviews of names, subtitles and descriptions. They are
frozen with each new AI audit, provided to both model calls and visible in
**Sources → Public listing examples** with their date and context. They cannot
justify keyword or promotional-text recommendations, replace an official source,
or establish features or performance of the audited app. Screenshot observations
feed the separate visual reviewer, alongside scoped Apple, Phiture and AppTweak
notes; they are not sent to the text reviewer. Historical audits
keep their previous references. No browser research runs during an audit.
The [planned research workflow](architecture.md#recherche-sur-trois-fiches-de-référence)
requires opening three well-known apps from different domains, recording coverage
and checking relevance separately from niche competitors. Public examples provide
test hypotheses, not evidence of conversion gains.

Maintainers can run the [ASO evaluation suite](aso-evaluation.md) against ten
synthetic cases using any connected provider. It keeps automated expectations
separate from human editorial review, saves inspectable reports, and supports
offline replay. The default command and CI tests make no paid calls.
