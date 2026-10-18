# Installation

[Documentation](README.md)

Panda Store is currently an alpha for local use. Choose Docker Compose or a native installation.

## Docker Compose demo

With Python 3, Docker Engine and Compose available, run from the repository root:

```sh
python3 scripts/bootstrap.py
docker compose up --build
```

Open **http://127.0.0.1:8080**, choose English or French, then create your organization
and owner account.
For browser research, download **Panda SMM Browser** from SMM and follow the
[connector instructions](../addons/studio/browser_extension/README.md). The current
connector reconnects open dashboard tabs automatically after installation or reload.
An unpacked extension still needs a manual reload when you replace its files.
This configuration uses PostgreSQL, Redis, a Celery worker, Django and Nginx.
Its database is separate from the local SQLite database. `docker compose down`
preserves data volumes; adding `--volumes` would delete them.

Compose is limited to localhost and demo mode. This is not a production
configuration. Read [SECURITY.md](../SECURITY.md) for current limitations.

### Visual preview without the backend

For a read-only look at the interface, start `npm --prefix web run dev` and open
**http://127.0.0.1:5173/?preview=1**. This explicit development-only preview uses
fictional apps and sample scripts. It makes no backend requests and cannot save,
import, generate or publish anything. Production builds exclude this preview.

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

Open **http://127.0.0.1:5173**. On the first visit, choose English or French, name
your organization and choose your username, email and password. Panda Store saves the organization and account
in this installation's database, stores a password hash, and opens the console.
Returning visits open the console while your session is valid; after signing out
or session expiry, sign in with the account you created. There is no cloud account
or email delivery during setup.
ASO and SMM are enabled in the new workspace, alongside the app catalog and store connections.
The example module is a developer reference and is hidden from the interface.

## Start with your app

If your app is not on a store yet, choose **My apps → Create a project**. Type or
paste your idea, or import a `.md` / `.markdown` file. Choose **Idea** or
**In development**, describe the audience and distinguish planned features from
those already implemented. The description is editable and accepts up to 20,000
characters. No store account is required. SMM can research comparable apps and
prepare launch content from this context. In ASO, choose an AI model and select
**Analyze idea and suggest listing** to get positioning analysis and a first App Store
listing. ASO proposes the name, subtitle, description, keywords and promotional text;
you can then save and edit the complete proposal in **Drafts**.

For an existing app, use **My apps → Import an app**, choose App Store or Google Play,
then select one app to import. Repeat whenever you want to add another app. See
[Connections](connections.md) for the account setup.

The interface language chosen during setup is saved in your account.
New AI analyses and explanations follow this language, including evidence reviews.
Store copy keeps the listing locale; scripts follow the language selected in their brief.
New briefs default to the account language. Imported listings and earlier results are preserved.

## Update an existing installation

The local configuration enables `PANDA_SETUP_ENABLED=true`. Setup can run only once.
To update an earlier alpha, add this setting to `.env` and run migrations: the
single seeded demo workspace can be renamed and claimed without losing its apps.
Installations with other existing accounts retain sign-in. The bootstrap script
preserves existing `.env` files; this file contains secrets and must never be published.

For a native installation, after pulling changes, install the Python requirements,
run `npm --prefix web ci`, apply migrations and restart the API, workflow worker and
frontend. The native worker does not reload backend code automatically. For Compose,
run `docker compose up --build`; its initialization service applies migrations.
For a folder-installed browser connector, follow its update instructions as well.

## Try the demo

Choose **My apps → Import an app → Store → Demo apps**, import **Runclub**, then use **SMM** to create
three directions from **Scripts → Demo templates · No AI**. You can also open **ASO → Run audit**
with **Rules only · No AI**. These two paths require no paid key. Browser research uses a
connected AI provider and the Chrome connector; its billing and coverage limits are shown
before it starts. The initial workspace is empty so you can try the actual import
flow. Local development uses SQLite and a background worker: no Redis service,
external account or paid AI key is required. Keep the worker terminal running.

For App Store Connect and Google Play imports, follow [Connections](connections.md). For research, install the [SMM browser connector](smm.md#social-research-in-your-browser).
