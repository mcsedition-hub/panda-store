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
store listings, or explore with fictional apps. Write a brief → create three
template scripts → edit → approve → export. AI generation, Google Play and
publishing are not implemented yet.

## What works

- First-run organization and owner setup, followed by direct access to the console.
- Persistent sessions, workspaces and owner/editor/viewer roles.
- A module registry with dependencies, compatibility checks and per-workspace activation.
- Two fictional apps, persistent imports and a history of metadata snapshots.
- App Store Connect API keys per workspace, app selection, localized listings,
  icons, primary-language screenshots and manual metadata refresh.
- ASO audits of imported Apple metadata: sourced field limits, exact keyword
  repetition, copyable cleanup proposals and explicit coverage gaps, per language.
- Editable briefs and three script variants built from local writing templates.
- Generation history, script editing, separate approval and Markdown exports.
- Live workflow steps and activity, stop requests, and retries that keep completed steps.
- An example extension using the same conventions as the built-in modules.

The Research, Publishing, Analytics and Agents illustrations are part
of the visual identity. Their features are not implemented yet.
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
UI follows sequential Studio and ASO steps; AI agents, parallel scheduling and a visual
workflow editor are still planned.

## Audit an App Store listing

Enable **ASO** in **Modules**, choose an imported app and language, then select
**Run audit**. Audits use the selected saved import, not a live store refresh.
Each result retains its inputs, sources and review date, with a persistent activity
log. **Run again** checks the latest imported snapshot; retrying an interrupted
audit keeps its original inputs and completed checks.

The initial rules check name, subtitle, description and promotional-text lengths,
the keyword budget, exact keyword repetition and comma spacing. A proposed cleanup
can be copied for review and manual application in App Store Connect. Apple's
conflicting byte/character keyword limits are disclosed; non-ASCII overflow is
flagged for review. Missing fields are not treated as empty store fields.

No AI key is required. This is a bounded metadata audit, not a complete compliance
review: visual quality, relevance, competitors, search demand and download impact
remain unassessed. Google Play audits, editorial AI, editable drafts and publishing
are not implemented. Passed checks are not an ASO score or a promise of growth.

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
