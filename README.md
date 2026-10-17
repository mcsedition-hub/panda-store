<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="web/public/brand/logo-dark.svg">
    <img src="web/public/brand/logo-light.svg" alt="Panda Store" width="380">
  </picture>
</p>

# Panda Store

A modular workshop to grow your mobile apps.
Self-hostable and source available under the [Elastic License 2.0](LICENSE).

English is the default product language. [Lire le README en français](README.fr.md).

**Alpha 0.1.0 — local development.** Connect an Apple account and import iOS
store listings, or explore with fictional apps. Research → select observations →
write a brief → generate three AI script drafts → edit → approve → export.
Local templates remain available in demo mode. Google Play and publishing are not implemented yet.

## What works

- First-run organization and owner setup, followed by direct access to the console.
- Persistent sessions, workspaces and owner/editor/viewer roles.
- A module registry with dependencies, compatibility checks and per-workspace activation.
- Two fictional apps, persistent imports and a history of metadata snapshots.
- App Store Connect API keys per workspace, app selection, localized listings,
  icons, primary-language screenshots and manual metadata refresh.
- ASO audits of imported Apple metadata: sourced field limits, exact keyword
  repetition, copyable cleanup proposals and explicit coverage gaps, per language.
- OpenAI, Google Gemini and Anthropic Claude connections, encrypted per workspace,
  with provider model discovery and optional ASO editorial recommendations.
- Listing drafts with autosave, comparison, named variants, revision history,
  manual review, text exports and comparison with refreshed Apple metadata.
- Studio research with provider web search, browser captures, source-linked observations
  and three cross-domain references, before creative writing.
- Editable briefs and three script variants built from local writing templates.
- Three AI script directions from selected research and author-confirmed product facts,
  with source references, an automated review and separate human approval.
- Generation history, script editing, separate approval and Markdown exports.
- Live workflow steps and activity, stop requests, and retries that keep completed steps.
- An example extension using the same conventions as the built-in modules.

Research is available within Studio. The Publishing, Analytics and Agents illustrations
are part of the visual identity; those modules are not implemented yet.
See the [roadmap](docs/roadmap.md).

## Run locally

Requirements: Python 3.12 and Node.js 24. From the repository root:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python scripts/bootstrap.py
.venv/bin/python manage.py migrate
npm --prefix web ci
```

Start the backend, workflow worker and frontend in three separate terminals:

```sh
.venv/bin/python -m uvicorn panda_store.asgi:application --host 127.0.0.1 --port 8000 --reload
```

```sh
.venv/bin/python manage.py run_workflows
```

```sh
npm --prefix web run dev
```

Open **http://127.0.0.1:5173**. On the first visit, name your organization and choose
your username, email and password. Panda Store saves the organization and account
in this installation's database, stores a password hash, and opens the console.
Returning visits open the console while your session is valid; after signing out
or session expiry, sign in with the account you created. There is no cloud account
or email delivery during setup.

The local configuration enables `PANDA_SETUP_ENABLED=true`. Setup can run only once.
To update an earlier alpha, add this setting to `.env` and run migrations: the
single seeded demo workspace can be renamed and claimed without losing its apps.
Installations with other existing accounts retain sign-in. The bootstrap script
preserves existing `.env` files; this file contains secrets and must never be published.

Choose **Connections → Try with demo apps**, import **Runclub**, then use the **Studio** to create
three directions. The initial workspace is empty so you can try the actual import
flow. Local development uses SQLite and a background worker: no Redis service,
external account or paid AI key is required. Keep the worker terminal running;
restart it after changing backend code. After updating an existing installation,
install the requirements and run migrations before restarting these processes.

Studio shows a saved activity log and clickable steps for each new generation.
Closing the page does not stop a workflow. **Stop** requests cooperative cancellation;
**Retry unfinished steps** creates a linked attempt with the original metadata and
brief, reusing completed results. Scripts still require separate approval.
Earlier generations remain available without retroactively invented activity.

`PANDA_WORKFLOW_DISPATCH=database` is the local default. Compose sets it to `celery`
and uses its Redis/Celery services instead. A queued workflow with no worker fails
after five minutes when inspected; an interrupted worker's lease expires after
45 seconds. Live clients and the local worker detect expired leases. The current
UI follows sequential Studio and ASO steps. Studio research can search, open and scroll a bounded
set of public pages. Open-ended browser navigation, parallel scheduling and a visual workflow
editor are still planned.

## Creative research

Studio opens on **Research**, before **Scripts**. Choose an app, enter a research topic and
market, then explicitly select an OpenAI, Google Gemini or Anthropic Claude model from your
workspace's connections. The selected model must support the provider's web-search tool and
image analysis; unsupported combinations fail explicitly, without switching providers.

For local development, install Chromium in the same Python environment as the worker:

```sh
.venv/bin/python -m playwright install chromium
# On Linux, install the system dependencies too:
.venv/bin/python -m playwright install --with-deps chromium
```

Restart the workflow worker after updating backend code. The Docker image includes Chromium;
Compose runs its non-root worker with the bundled Playwright seccomp profile and shared memory.
Chromium's sandbox must be supported by the host. A launch check runs before paid discovery.
On Ubuntu, the installed Chromium executable may need an AppArmor profile allowing `userns`,
as described in the [Ubuntu documentation](https://documentation.ubuntu.com/security/security-features/privilege-restriction/apparmor/).
CI loads a profile for that exact executable; it does not disable Chromium's sandbox or change
system-wide namespace restrictions.

Research uses up to three model calls: web discovery, analysis, and an independent review against
the same saved evidence. Provider search fees are additional. OpenAI/Claude searches are bounded
to three tool calls; Google's requested three-query limit is advisory, not a hard billing cap.
Actual provider usage is retained per completed step. Timeouts may still be billed and never
trigger an automatic paid retry.

The browser opens up to six discovered sources and three cross-domain App Store references
(Duolingo, Spotify and Tinder), scrolls once and saves two page views, bounded text, dates and
content hashes in this installation's database. It uses an ephemeral session without personal
cookies. Private addresses, credentials in URLs, downloads, media playback, form submission,
embedded frames and WebSockets are not available. Site access policies and login/challenge walls
can leave sources unavailable. This is page/still research, not video or audio analysis.

Results separate discovered links, captured pages, reviewed observations and withheld claims.
Visible metrics retain their exact quoted labels; no popularity score, install attribution or
performance guarantee is inferred. The three large apps are structural references, not assumed
niche competitors. Every session exposes its actual coverage, including missing references.
The research inputs and saved evidence are immutable. **Retry unfinished steps** reuses completed
work; **Retry unavailable sources** keeps the search and readable pages and creates a new attempt
for the missing pages, without changing the original report. Analysis/review calls may run again.

Full video analysis, authenticated social connectors and publishing remain planned.

## Create scripts from research

In **Research**, select one to three retained observations and choose **Use observations in brief**.
Studio saves the selection and opens **Scripts**. Define the audience, goal, tone, language and
target duration, then enter the product facts the script may use. Confirm those facts and select
a model from your workspace's OpenAI, Gemini or Claude connection. **Create scripts** runs two
model calls: writing three directions and reviewing their claims, sources and distinctness.

Each generation freezes the selected import, brief, source observations and connection revision.
Research informs structure; it does not authorize copying competitor text or transferring features,
prices or performance claims. Exact product fact quotes and source IDs are checked in code. The
second model review can still miss errors, so scripts require human review before use. A rejected
review withholds all three scripts and displays its reasons. Adjust the brief and start a new
generation; retry is for interrupted work, not for repeatedly approving rejected content.

When only the review times out, **Retry unfinished steps** reuses completed writing. No automatic
paid retry or provider switch occurs. Usage is recorded for completed calls; reused steps retain
their original counts and timed-out calls may still be billed. Editing a script clears its approval.
**Research adaptation** preserves the original AI rationale; subsequent human edits are not
automatically rechecked. The Markdown export includes the sources and the confirmed facts.

These are editable scripts and shooting directions, not generated video files. Target duration is
an estimate. No social account is connected or post published. AI generation works with demo mode
disabled; **Demo templates · No AI** remains a separate optional local mode.

## Audit an App Store listing

Enable **ASO** in **Modules**, choose an imported app and language, then select
**Run audit**. Audits use the selected saved import, not a live store refresh.
Each result retains its inputs, sources and review date, with a persistent activity
log. Running a new audit checks the latest imported snapshot; retrying an interrupted
audit keeps its original inputs and completed checks.

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

### Choose an AI model

Open **ASO → Audit → AI settings**. A workspace owner can connect OpenAI, Google
Gemini or Anthropic Claude with their own API key. Keys are encrypted in this
installation's database using `PANDA_CREDENTIAL_KEYS`, never returned to the browser
or shared between workspaces. **Refresh models** reloads the provider's catalogue;
text model families are filtered for this integration. Model access, quotas and
endpoint compatibility are still subject to the provider; failures are explicit.

Select **AI provider**, **Model** and **Language**, then **Run audit**. The selected
language's imported text is sent to that provider, using its account and billing.
There is no provider fallback or automatic paid retry. **Rules only · No AI** keeps
the original checks available without a key. All three adapters have automated
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
Maintainers extend [the versioned annotations](addons/aso/knowledge/editorial.json)
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
OpenAI, Gemini and Claude image adapters have contract tests; live visual validation
is recorded in [the evaluation notes](docs/aso-evaluation.md).

Bounded JPEG derivatives are archived privately in the database, together with
dimensions, capture time and SHA-256. Each review stores at most 15 MB of image
data, usually much less. Include these rows in database backups; no shared media
volume is required between the API and worker. Apply migrations and restart both
services when upgrading. Access requires workspace membership and an active ASO module.

The [backing research](addons/aso/knowledge/visual-research.json) records a browser
review on October 17, 2026 (US App Store, English, iPhone gallery). Selected **text**
observations now supplement reviews of names, subtitles and descriptions. They are
frozen with each new AI audit, provided to both model calls and visible in
**Sources → Public listing examples** with their date and context. They cannot
justify keyword or promotional-text recommendations, replace an official source,
or establish features or performance of the audited app. Screenshot observations
feed the separate visual reviewer, alongside scoped Apple, Phiture and AppTweak
notes; they are not sent to the text reviewer. Historical audits
keep their previous references. No browser research runs during an audit.
The [planned research workflow](docs/architecture.md#recherche-sur-trois-fiches-de-référence)
requires opening three well-known apps from different domains, recording coverage
and checking relevance separately from niche competitors. Public examples provide
test hypotheses, not evidence of conversion gains.

Maintainers can run the [ASO evaluation suite](docs/aso-evaluation.md) against ten
synthetic cases using any connected provider. It keeps automated expectations
separate from human editorial review, saves inspectable reports, and supports
offline replay. The default command and CI tests make no paid calls.

## Connect an Apple account

In **Connections → Connect Apple**, enter a connection name, key type, Key ID,
and upload the `.p8` file. Team keys also require an Issuer ID; individual keys
use the user's existing access. Create the key in Apple's interface using the
[App Store Connect API instructions](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/).
Panda Store never asks for an Apple ID password. No Apple credentials belong in `.env`.

The workspace owner manages connections; editors can import and refresh apps;
viewers have read-only access. Each workspace can connect multiple accounts.
Keys are checked with Apple before saving and encrypted in this installation's
database. Only GET requests are sent to Apple, with short-lived, read-scoped JWTs.
After connecting, choose an app, import it and open its metadata in **My apps**.
**Refresh metadata** saves a new snapshot only when the imported content changes.

An iOS version must exist in App Store Connect. The importer prefers the latest
published iOS version, otherwise the newest draft; its state appears in the app
detail. Text is imported for all available languages, screenshots for the app's
primary language. Imports are synchronous and bounded to 60 requests / a 20-second
operation budget (individual network reads may finish later). Large listings may
reach this limit; background imports and scheduled refresh are not implemented.
Catalog listing, iOS import (localized text, icon, category and primary-language
screenshots), and refresh without duplicate snapshots have been verified against
a real developer account with an App Manager team key. Automated tests cover
individual keys; live validation of those keys remains to be completed.

`scripts/bootstrap.py` generates `PANDA_CREDENTIAL_KEYS` for new installations.
To update an existing alpha, back up its database and environment, then run:

```sh
.venv/bin/python scripts/bootstrap.py --add-credential-key
.venv/bin/python manage.py migrate
```

Restart the backend (and workers in Compose). This adds a missing encryption key
without replacing existing configuration. Back up that key separately from the
database: losing it makes saved credentials unreadable. Disconnecting removes
the saved key and stops refreshes while preserving imported apps; revoke the key
in Apple's interface if you also want to invalidate it at Apple.

## Docker Compose demo

With Docker Engine and Compose running:

```sh
python3 scripts/bootstrap.py
docker compose up --build
```

Open **http://127.0.0.1:8080** and complete the same first-run setup.
This configuration uses PostgreSQL, Redis, a Celery worker, Django and Nginx.
Its database is separate from the local SQLite database. `docker compose down`
preserves data volumes; adding `--volumes` would delete them.

Compose is limited to localhost and demo mode. This is not a production
configuration. Read [SECURITY.md](SECURITY.md) for current limitations.

### Visual preview without the backend

For a read-only look at the interface, start `npm --prefix web run dev` and open
**http://127.0.0.1:5173/?preview=1**. This explicit development-only preview uses
fictional apps and sample scripts. It makes no backend requests and cannot save,
import, generate or publish anything. Production builds exclude this preview.

## Development checks

```sh
.venv/bin/ruff check .
.venv/bin/ruff format --check .
.venv/bin/pytest
.venv/bin/python manage.py check
.venv/bin/python manage.py makemigrations --check --dry-run
npm --prefix web test
npm --prefix web run format:check
npm --prefix web run build
```

CI runs backend tests against PostgreSQL and frontend tests with jsdom.
Frontend tests do not replace a visual review in a browser.

```text
panda_store/       Django configuration, accounts, workspaces and module registry
addons/           Django modules, manifests and React interfaces
web/              React/TypeScript shell, design and local assets
docs/             architecture, module contracts, licensing and roadmap
tests/            workflow and workspace isolation tests
deploy/           local Compose reverse proxy
```

Detailed technical and policy documents are currently in French:

- [Architecture](docs/architecture.md)
- [Module development](docs/modules.md)
- [Development environment](docs/development.md)
- [Contributing](CONTRIBUTING.md)

## Licensing and the cloud edition

ELv2 allows internal use and self-hosting. It prohibits providing the software
to third parties as a hosted or managed service that exposes a substantial set
of its features. It **does not prohibit all commercial activity**.
The full licence text governs.

This restriction protects the project against being repackaged as a competing
hosted service. An official cloud offering is planned but has not launched.
This edition is **source available**, not OSI open source. The agreement needed
for external code contributions is being prepared; see [licensing](docs/licensing.md).

Odoo inspired the modular organization. Panda Store has its own code, interface
and visual identity; no Odoo code or visual assets are included.
