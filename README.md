# Panda Store

A modular workshop to grow your mobile apps.
Self-hostable and source available under the [Elastic License 2.0](LICENSE).

English is the default product language. [Lire le README en français](README.fr.md).

**Alpha 0.1.0 — local demo.** Explore the product, develop modules and try a
complete workflow: import a fictional app → write a brief → create three scripts
→ edit → approve → export. This version does not call Apple, Google or an AI
provider, and does not publish content.

## What works

- Session-based sign-in, workspaces and owner/editor/viewer roles.
- A module registry with dependencies, compatibility checks and per-workspace activation.
- Two fictional apps, persistent imports and a history of metadata snapshots.
- Editable briefs and three script variants built from local writing templates.
- Generation history, script editing, separate approval and Markdown exports.
- An example extension using the same conventions as the built-in modules.

The ASO Audit, Research, Publishing, Analytics and Agents illustrations are part
of the visual identity. Their features are not implemented yet.
See the [roadmap](docs/roadmap.md).

## Run locally

Requirements: Python 3.12 and Node.js 24. From the repository root:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python scripts/bootstrap.py
.venv/bin/python manage.py migrate
.venv/bin/python manage.py seed_demo
npm --prefix web ci
```

Start the backend and frontend in separate terminals:

```sh
.venv/bin/python manage.py runserver 127.0.0.1:8000
```

```sh
npm --prefix web run dev
```

Open **http://127.0.0.1:5173**. Use `PANDA_DEMO_USERNAME` and
`PANDA_DEMO_PASSWORD` from your local `.env` file. The bootstrap script generates
random secrets once. The file is excluded from Git; never publish it.

Choose **Connections**, import **Runclub**, then use the **Studio** to create
three directions. The initial workspace is empty so you can try the actual import
flow. Local development uses SQLite and synchronous tasks: no external account
or paid AI key is required.

## Docker Compose demo

With Docker Engine and Compose running:

```sh
python3 scripts/bootstrap.py
docker compose up --build
```

Open **http://127.0.0.1:8080** using the same credentials from `.env`.
This configuration uses PostgreSQL, Redis, a Celery worker, Django and Nginx.
Its database is separate from the local SQLite database. `docker compose down`
preserves data volumes; adding `--volumes` would delete them.

Compose is limited to localhost and demo mode. This is not a production
configuration. Read [SECURITY.md](SECURITY.md) for current limitations.

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
