# Development

[Documentation](README.md) · [Installation](installation.md)

The documented setup uses venv/pip and npm. `requirements.txt` contains the server
dependency versions validated with Python 3.12; `requirements-dev.txt` adds development
tools. `web/package-lock.json` pins the frontend dependency graph. The ranges in
`pyproject.toml` describe package compatibility.

To revise dependencies, use a clean environment, update ranges if needed, then
regenerate and test the pinned files:

```sh
pip-compile --strip-extras --no-emit-index-url --no-emit-trusted-host --output-file requirements.txt pyproject.toml
pip-compile --extra dev --strip-extras --no-emit-index-url --no-emit-trusted-host --constraint requirements.txt --output-file requirements-dev.txt pyproject.toml
```

Do not include private indexes, tokens, user paths or local editable dependencies
in these files. Test a fresh installation, backend and frontend before proposing
the update.

## Main variables

| Variable | Purpose |
| --- | --- |
| DJANGO_SECRET_KEY | Locally generated signing secret |
| PANDA_CREDENTIAL_KEYS | Comma-separated Fernet keys for this installation; the first encrypts Apple, Google Play and AI keys entered through the interface |
| DJANGO_DEBUG | Local debugging only |
| DJANGO_ALLOWED_HOSTS | Comma-separated allowed hosts |
| DJANGO_CSRF_TRUSTED_ORIGINS | Allowed development origins |
| DATABASE_URL | Local SQLite or PostgreSQL |
| PANDA_DEMO_MODE | Enables fictional data and local templates |
| PANDA_SETUP_ENABLED | Enables initial setup for an empty installation or the single legacy demo workspace |
| PANDA_DEMO_USERNAME / PASSWORD | Account for the old seed_demo tool; new accounts are created through setup |
| PANDA_MODULE_PACKAGES | Complete list of installed module apps |
| PANDA_WORKFLOW_DISPATCH | `database` by default for the local worker; `celery` in Compose |
| PANDA_AI_TIMEOUT_SECONDS | AI generation request deadline, 300 seconds by default; integer from 30 to 900 |
| CELERY_TASK_ALWAYS_EAGER | Synchronous Celery task execution, used in tests |
| CELERY_BROKER_URL | Redis for asynchronous tasks |
| DJANGO_SECURE_COOKIES | HTTPS cookies by default outside DEBUG |
| POSTGRES_PASSWORD | Password for local Compose PostgreSQL |

`scripts/bootstrap.py` never replaces an existing `.env`. The explicit
`--add-credential-key` option adds only a missing encryption key entry when upgrading
older installations. Restart the API and worker afterward. Apple and Google Play
credentials belong to each workspace and are entered in Connections. AI keys are
configured in AI settings; placing a key in an environment file does not create a
connection accessible to users.
`seed_demo` remains for older demos and refuses an already configured installation.
Normal startup no longer runs it. Setup creates the owner, workspace and modules
in a single transaction, then opens a Django session. The Installation record prevents
a second setup, even if two tabs try to finish simultaneously. The old
`PANDA_LOCAL_ACCESS` option is no longer used: no passwordless session is created
at startup. To change a password: `python manage.py changepassword <username>`.

SQLite stores accounts, organizations, sessions and business data locally in
`panda.sqlite3`. Compose stores the same tables in its PostgreSQL volume. The browser
does not retain the password; its session cookie identifies a server-side session.
Email is stored but not verified by sending a message; password recovery by email
is not implemented yet.

## Interface, languages and models

Interface translations are in `web/src/i18n`. The English or French choice made during
setup is saved on the account. New AI calls receive that language for their analyses;
store copy and scripts retain the language of their listing or brief. Preserve this
distinction when adding a field.

The shared selector shows up to five main models per provider, followed by a full
list. Usage guidance and sources are in `web/src/ai/modelProfiles.ts`. Refreshing a
connection's catalogue changes available models, not this guidance. Displayed
capabilities and settings must stay aligned with the adapters in `panda_store/ai`.

The Chrome connector is in `addons/studio/browser_extension`. After a change, reload
the extension from `chrome://extensions`; the dashboard reconnects without losing
the form. See its [instructions](../addons/studio/browser_extension/README.md).

## Checks

From the repository root:

```sh
.venv/bin/ruff check .
.venv/bin/ruff format --check .
.venv/bin/pytest
.venv/bin/python manage.py check
.venv/bin/python manage.py makemigrations --check --dry-run
npm --prefix web test
node --test tests/browser_extension.test.mjs
npm --prefix web run format:check
npm --prefix web run build
```

Start the local backend with `python -m uvicorn panda_store.asgi:application
--host 127.0.0.1 --port 8000 --reload`. Run `python manage.py run_workflows` and Vite
separately. The local worker polls the durable database queue once per second and
uses the same steps as Celery; it does not reload code automatically. This worker
needs no developer account, store credentials or AI model. `run_workflows --once`
processes at most one task.

Compose uses Uvicorn/ASGI, Redis and Celery. Nginx forwards SSE events without
buffering. Each connection lasts at most 25 seconds, and the browser resumes from
its last cursor; fallback polling maintains tracking if the stream is interrupted.
Local writing-template steps can finish in less than a second: no artificial delay
extends generation.

Tests cover the main flow, CSRF token, roles, object isolation between workspaces,
module dependencies, repeated imports, repeated generations and their errors.
Frontend tests cover save ordering, edits, approval and network errors.

Local tests use SQLite; concurrency checks requiring PostgreSQL locks are skipped.
To test with PostgreSQL, supply a disposable database through `TEST_DATABASE_URL`
and run pytest. The account must be able to create a test database. Never use a
production database.

CI includes a PostgreSQL service. Before a release, also verify Compose and the
browser flow: sign-in, import, worker generation, editing, approval and export at
mobile and desktop widths. A successful build alone does not establish correct
visual rendering.
