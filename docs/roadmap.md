# Roadmap

This roadmap distinguishes agreed scope, shipped features and remaining validation.
It does not promise a release date.

## First public release scope

The self-hosted community edition focuses on **two business modules: ASO and SMM**.

**ASO** analyzes store listings, prepares corrections, and supports editing and export.
**SMM** finds high-performing content in the user's browser, qualifies references,
then creates, edits and exports one to three distinct adaptations that respect their
formats and the app's confirmed features.

The app catalogue, Apple, Google Play and AI connections, workspaces and workflows
provide the foundation. The example module serves developers. No third business
module is planned for this first release; user feedback will guide later additions.

**Reserved for the future cloud edition:** connecting social accounts and pages for
publishing, sending and scheduling content. These features remain to be built and
are not prerequisites for the community release. The research browser connector
stays in community SMM; it uses the browser session to inspect content without
establishing a publishing connection.

## Current state

| Area | Expected result | Status |
| --- | --- | --- |
| Foundation | Workspaces, modules, Markdown project descriptions, imports, languages and exports | Alpha implemented; English or French selected during setup |
| Real app | App Store Connect, app selection, snapshots, connection errors | Import and refresh validated with a real Apple account and team key |
| ASO audit | Proposal from an idea or analysis of an imported listing, with sources and corrections | Five Apple fields, history, model comparison, screenshot review and drafts implemented; research specific to each audit remains to be built |
| Workflows | Live steps, durable log, stop and retry | Shared ASO/SMM foundation and AI generation implemented; parallel branches and editor remain to be built |
| SMM research | Relevant content found in the browser with performance evidence | History, network filters, four qualified references visible by default and expandable remaining results; live validation detailed below |
| SMM creation | One to three adaptations of distinct references, following their formats and product facts | One adaptation per selected source; compatible references reusable across research sessions; editable and exportable scripts |
| Google Play | Import Android listings, then extend ASO | Connection, selective import and refresh validated with a real account on October 18; Android ASO audit remains to be built |
| Measurement | Campaign links, time series, reports and attribution limits | Prioritize after user feedback; outside the first public release |
| SMM publishing (cloud) | Connected social accounts and pages, publishing and scheduling, preview and sending status | Reserved for cloud, to be built |
| Cloud operations | Stronger isolation, billing, quotas, backups, support | To be built for the hosted offering |

## Next milestone

**Priority: complete ASO and SMM flows for independent first-time use.**
Live collection and generation across formats have been exercised. Release preparation
now focuses on reliability, installation, interface clarity and exports. See the
[SMM scope](architecture.md#smm-module-organic-marketing).

Remaining work includes live validation of GLM vision models, trials with other accounts
and configurations, and human calibration of ASO recommendations. Video/audio coverage,
reference research specific to each audit and Google Play audits remain separate work.
Social publishing and hosting operations belong to the future cloud edition.

### October 18, 2026 update

The catalogue accepts an idea typed, pasted or imported as Markdown. ASO proposes
the complete listing, including Apple's 170-character promotional text; SMM prepares
launch content from the same project. Audience-facing copy uses described features
without mandatory development-stage commentary. Undocumented facts and availability
claims remain excluded.

ASO results survive navigation and can be compared across models, with draft creation
from selected fields. The English or French choice during setup also applies to new
AI explanations. OpenAI, Gemini, Claude and Z.ai share the same model guide: at most
five main choices, a full list and a recommendation suited to the module.

SMM research accepts one to three qualified sources. It shows four qualified references
by default, offers the rest, and hides other results behind a separate action. Network
filters preserve selection. New research remains accessible from Research, Scripts
and Scenes without deleting old sessions. The example module stays in the repository
for developers and is hidden from the interface.

Connector 0.1.8 reconnects open Panda Store tabs after installation or reload; 0.1.7
remains compatible. Folder installations still need a manual reload to apply new
files. Missing Instagram counters can be looked up on the creator's Reels grid with
evidence for the exact post. JPEG captures are normalized before saving.

Live Google Play import confirmed two languages, five phone screenshots and a feature
graphic, preserving the snapshot after a temporary error and successful retry.
GLM passed connection and structured text output checks; live vision validation remains
pending after a provider overload response. See [Connections](connections.md) for details.

Code validation at commit
[`2a87923`](https://github.com/mcsedition-hub/panda-store/commit/2a87923d74b0732897bd6335331aef3214f5f272)
finished with **551 backend tests passed and 3 skipped on SQLite**, **221 interface
tests** and **46 connector tests** passed. Ruff, formatting, Django checks, missing
migration checks and frontend build passed. The three skipped tests require PostgreSQL;
the PostgreSQL validations below are from October 17 and do not represent a new run
of the October 18 suite.

### Initial validation on October 17, 2026

This record preserves that day's versions and results. Behaviors changed since then,
including reference count and browser connection, are described in the update above
and the user guides.

Validation on October 17, 2026 used an isolated repository copy, a new Python
environment, `npm ci` and an empty SQLite database, without keys or data from the
working installation. Remaining items are identified separately.

- [x] **Native installation.** Dependency installation, repeatable bootstrap, migrations,
  API, interface and worker startup. Account creation from Chrome; ASO and SMM enabled
  during initial setup.
- [x] **ASO without an AI key.** Runclub import, worker-completed audit, visible findings
  and limits, subtitle editing, persistence after reload and saved-revision export verified.
- [x] **SMM editing and exports.** Three demo scripts created, edit saved and recovered
  after reload, export verified. The real MonTri UGC/carousel/text batch export preserves
  product facts, references, missing or rounded counters, formats, limits and review
  corrections. The three adaptations remain unapproved.
- [x] **Automated checks.** 367 server tests passed on PostgreSQL, including the three
  concurrency tests skipped on SQLite (364 passed). The interface suite had 123 passing
  tests; all 23 connector tests also passed. Formatting, Django checks, missing migration
  checks and production build verified. A late library response no longer removes
  audio that was just imported.
- [x] **Docker flow.** Image build, Nginx/API/Redis/Celery startup, Chrome sign-in,
  fictional import, ASO/SMM workflows, draft and exports verified with an empty
  PostgreSQL 17 database. Account, results, draft and exports survived `down` then `up`
  without removing volumes. The check passed with the shipped Compose file, without
  overrides, on a new `postgres:17-alpine` database. The 66 tests targeting drafts,
  workflows, SMM research and concurrent account creation also passed with this image.
- [x] **PostgreSQL Alpine image in shipped Compose.** The `exec format error` came from
  the local unpacked cache: the entry script was empty in the container but intact
  in the image archive (14,577 bytes). After backup, removal of only the local image
  and a fresh download of the same digest, the script and startup worked. No volume
  or user data was deleted; no project image change was necessary.
- [x] **Connector 0.1.5 in Chrome.** Manual loading, connection to dashboards on 5173
  and 8080, and ZIP download from Compose verified. Distributed files matched sources.
  Origins 5173, 8000 and 8080 are covered by tests. The live test found two overlapping
  close buttons on Facebook Reels: the connector now chooses the accessible control.
  Reading is limited to the active video card to exclude preloaded Reel counters.
  The version tested that day was 0.1.5 on both installations.
- [x] **Collection resume in the assembled version.** Live collection and cross-research
  selection were verified on the working installation. With 0.1.5: stop after one
  capture, refresh, resume and finish with six distinct posts. The first evidence
  ID, date, text and images remained identical; no new reference passed filters.
  The Sweepr Reel retained three images and unknown counters without taking values
  from the next Reel. On Compose/PostgreSQL, a prepared plan and public MonTri context
  were added to the test account without copying an AI connection. Stop after two
  captures, refresh, resume and stop again after four distinct posts were verified
  in Chrome. IDs, dates, text and JPEG hashes were identical for the first two items,
  checked through the HTTP API. This test covers collection and persistence; it does
  not replay planning or AI analysis on Compose. Final filter verification finished
  through the worker with zero qualified references. That version required three
  qualified references and blocked generation; the current version accepts one to
  three. The activity message is hidden when research is stopped or completed.
- [x] **Visual review of main flows.** ASO audit and draft editor, SMM brief, workflow
  and editor examined in Chrome on a wide screen and at 390 px. Fields and actions
  remained accessible; ASO comparison and SMM steps stacked on narrow screens.
  Real references with long text and captures, followed by the MonTri UGC/carousel/text
  batch, were also reviewed at 390 px. SMM grid overflow was fixed: the page stays
  within screen width and only the capture strip scrolls horizontally.
- [x] **ASO/SMM errors and retries.** Voluntary stop no longer displays an error or a
  second stop request. A browser verification blocks automatic finalization of partial
  collection: captures remain saved, with explicit resume or analysis of available
  posts. Browser connection is rechecked before starting and resuming. History,
  activity and AI connection read failures offer reload without creating a task.
  A connection read failure is no longer shown as a key-storage problem. Reload also
  retrieves a connection revision changed elsewhere. AI errors explain when to retry
  and when to start a new task after changing a key or model. Rejected-key and
  unavailable-provider cases were examined in Chrome with isolated fixtures and no
  paid AI call. An actual outage of the isolated Compose API displayed AI and ASO
  read errors; after restart, reload buttons successfully fetched connections and
  history. All 33 provider-error tests passed; 25 SMM/workflow tests and the build
  passed after the last display fix.

Current analysis covers text and partial captures, without complete video or audio.
AI review remains fallible: results need review and corrections must be retained.
Extending coverage is a later improvement.

The current foundation retains sources, briefs, product facts and logs, and provides
AI scripts, editable plans, media, ZIP exports and MP4s. See the [shipped flow](smm.md).
These tools can support content that needs them; editing extensions and voice synthesis
are not the next milestone.

### ASO: current state and future work

ASO is available and can be activated. The initial audit checks lengths, keyword
budget and exact repetition, with dated Apple sources, copyable cleanup proposals
and explicit coverage limits. It retains the selected import and uses shared
three-step tracking. Download impact is not evaluated automatically. Apple's
100-byte versus 100-character discrepancy is shown for review. Drafts and
OpenAI/Gemini/Claude/GLM editorial review are implemented, with explicit model
selection and sourced proposals for review. The project adds a separate check of
observations and proposals against the listing: unsupported inferences are removed,
and incomplete checks prevent report saving. Up to two model calls are announced,
with separate usage. Seven fixed cases check observed reasoning errors and
counterexamples before extending the check.
The ten-case synthetic suite includes automated checks, inspectable reports and
a human review rubric. Initial criteria remain provisional: specialist calibration,
consented real cases and a held-out set are still needed. See [ASO evaluation](aso-evaluation.md).
The AI library contains five method annotations and three public listing examples,
with their limits and scope. `Sources` exposes notes retained for each audit and
those intended for new audits. Apple remains the official reference; Phiture,
AppTweak and SplitMetrics supply working methods. Screenshot review and briefs are
shipped. Next work focuses on calibration and research tools. The
[design](architecture.md#specialized-aso-agent-design) calls for a specialized agent,
a curated document library and a graph linking rules, observations, proposals and
results. The initial selection includes Apple, Google, Phiture, AppTweak and
SplitMetrics; Google is not included in Apple review. Indexing and the graph remain
to be implemented.

Screenshot preparation includes a [document review and three listings examined
in the browser](../addons/aso/knowledge/visual-research.json): Duolingo, Spotify
and Tinder, in three different domains, on October 17, 2026. Three text annotations
from this review are included in new audits and visible in Sources; visual
observations feed the separate screenshot review. Claim checking distinguishes
examples from evidence specific to the app. The research milestone must open three
listings on every run, show sources and coverage, verify example relevance and freeze
observations with the audit. Incomplete visits must remain visible. Add niche research
separately; a major app's choices do not establish their effectiveness. See the
[flow criteria](architecture.md#research-across-three-reference-listings).

ASO remains usable independently of SMM. For each store and language, distinguish
verifiable official constraints from editorial recommendations: names, subtitles
or short descriptions, descriptions, keywords where available, categories and visuals.
Each finding must retain the observed field, rule or recommendation, official link,
verification date and proposed correction. Flag missing or unverifiable data.
Initial sources are Apple's guidance on the
[product page](https://developer.apple.com/app-store/product-page/) and
[App Store search](https://developer.apple.com/app-store/search/), and
[Google Play listing setup](https://support.google.com/googleplay/android-developer/answer/9859152?hl=en).
Do not present metadata compliance as a ranking or download guarantee. Apple and
Google criteria remain distinct; a full Google audit still needs to be developed
beyond the available Google Play import.

Users review proposals before applying them. The current Apple connector remains
read-only: corrections can be copied and applied in App Store Connect, then a new
import can verify changes. Listing edits and automatic publishing are not implemented.

### ASO flow and drafts

The initial shipped flow lets users open an app, choose the App Store language and
run `Run audit`. App context, language and last synchronization date remain visible.
Results show each problem with current content, a concrete proposal, rationale and
sources. `Add to draft` creates a draft containing only the selected proposal;
users can then edit it. `New draft` also allows starting from the selected imported
language without an automatic proposal.

ASO provides `Audit`, `Drafts` and `Sources`, with activity integrated into the audit.
The first audit is the empty screen's primary action. One draft is enough to start;
`Duplicate` creates a named variant with autosave and inspectable history. The editor
compares the reference or latest import with the draft, marks differences with labels
as well as colors, shows field limits and provides a preview. On small screens,
these views stack vertically. The imported listing remains intact; a refresh that
changes the draft's reference flags differences for review without overwriting work.

Output actions are `Copy changes`, `Export changes` and `Refresh and compare`
(or comparison with the saved import if Connections is disabled). They support manual
application in the store console. `Draft`, `Ready` and a detected import match describe
different facts: an approved draft is not published, an export is not publication,
and an import match confirms live availability only if the store status supports it.
Detection date does not replace the actual publication date. Restoring an old draft
revision does not undo anything on the store.

Experiments and results will come with the required integrations: preparing two
variants does not launch an A/B test. Measurement methods and testable fields depend
on the store. A `Results` area will be introduced when data can be linked to changes,
with its period and limits. `Activity` retains execution history. During an audit,
tracking appears directly in the module without requiring users to leave their app:
steps, status, current action and intermediate results.

### Workflows and live agent tracking

The requested interaction model draws on GitHub Actions execution graphs and n8n
workflows. Each module provides a ready-to-run flow. A short sequence uses a step
list; dependencies, branches and parallel tasks use a graph. Clicking a step opens
its activity, inputs, results and sources. The execution graph is separate from the
ASO knowledge graph, which links recommendations to evidence.

ASO example: synchronize the listing, check rules and study references in parallel
when dependencies allow, prepare proposals, verify evidence, then return corrections
for the user to compose a draft. `Needs review` signals required intervention, with
its reason and possible actions. Draft preparation publishes nothing.

The live log records observable actions: a page opened with its URL, capture available,
check completed, source inaccessible or proposal created. A step shows `Queued`,
`Running`, `Needs review`, `Completed`, `Failed`, `Canceled` or `Skipped`, duration
and last activity. Quantified progress uses a known total; a long task without a total
shows its current action. Estimated costs remain distinct from reported usage.
A deterministic check is presented as such, not as an AI agent.

Users can request a stop, inspect available results and retry a failed step when
safe. Refreshing or closing the tab does not lose the execution. Errors explain
the useful cause and possible action. ASO and SMM share this tracking while retaining
their own business steps. Advanced visual workflow editing can follow, using the
same versioned definition.

References: [GitHub Actions graph](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-the-visualization-graph)
(official screenshot examined) and
[n8n execution history](https://docs.n8n.io/build/understand-workflows/understand-executions/view-executions-for-a-single-workflow).
The shared foundation is implemented in SMM and ASO: task-specific steps, SSE log
with reconnection and fallback polling, cooperative stop, and retry of unfinished
steps with original inputs. Completed results are reused and the previous trace
is preserved. The local worker uses the database; Compose uses Celery. User-browser
control and SMM AI steps are implemented. Parallel branches, the editor and broader
autonomous supervision remain future work on the shared foundation.

Drafts belong to the installation database and require no GitHub account. In this
product flow, GitHub Actions refers to visual step tracking. Repository branches
and pull requests concern code development separately. The GitHub Actions
[`Checks`](../.github/workflows/ci.yml) workflow already runs tests, formatting and
builds on pushes and pull requests; business tasks run inside Panda Store.

References visually consulted on October 16, 2026:
[AppTweak Metadata Simulator](https://help.apptweak.com/en/articles/400809-test-your-keyword-selection-to-optimize-your-metadata)
for drafts and differences,
[Apple Product Page Optimization](https://developer.apple.com/app-store/product-page-optimization/)
for original and variant previews, and
[Google Publishing overview](https://support.google.com/googleplay/android-developer/answer/9859654?hl=en)
for separating preparation, review and publication. The Google capture from the
[official 2023 post](https://android-developers.googleblog.com/2023/01/control-when-changes-to-your-app-are-sent-for-review-with-new-play-console-features.html)
is a structural reference, not a guarantee of current appearance.

SMM already has replaceable AI providers and structured outputs. Next work should
evaluate adaptations by format from qualified references, with budgets per research
and generation. Retain the metadata snapshot used for each result. Demo mode remains
available for tests without a paid key.

The Apple connector was verified with a real account and an App Manager team key:
catalogue, languages, icon, category, screenshots and refresh without duplication.
Individual keys still need live validation. Imports are synchronous and bounded;
plan tasks for large catalogues and scheduled synchronization. Key revocation remains
an action in App Store Connect.

## Choosing AI providers and models

Users choose OpenAI, Anthropic (Claude), Google (Gemini) or Z.ai (GLM), then an
available model compatible with the task. This applies to AI-assisted ASO and SMM;
legacy server-side web discovery does not support Z.ai. The catalogue can be refreshed;
no Panda Store developer model or account is imposed on an independent installation.

Each workspace configures its own keys through the interface, with encrypted
server-side storage. A persistent model preference per workspace remains to be built;
each task uses an explicit choice. Selection considers required capabilities (text,
images, tools) and budget. If a model is unavailable or incompatible, show an explicit
error; do not send data to another provider without user selection. Retain provider,
exact model ID and usage in every execution for inspection.

## Success criteria

Research preserves URLs and dates, distinguishes ads from organic posts and identifies
actually observable metrics. A heavily viewed video does not prove it generates installs.

The browser agent can open and browse allowed pages but does not bypass authentication,
technical restrictions or access rights. Page content is untrusted data, never instructions.

In the future cloud edition, every publication requires available API permissions
for the account and content approval. Platform reviews may limit access.

A before/after comparison alone does not establish causality. Measurement must expose
biases, comparison windows and attribution limits.

Community modules retain their original licenses and notices when integrated into
a commercial cloud offering.
