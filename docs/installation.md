# Installation

[Documentation](README.md)

Panda Store is currently an alpha for local use. Choose Docker Compose or a native installation.

## Docker Compose demo

With Python 3, Docker Engine and Compose available, run from the repository root:

```sh
python3 scripts/bootstrap.py
docker compose up --build
```

Open **http://127.0.0.1:8080** and create your organization and owner account.
SMM browser research on this port requires **Panda SMM Browser 0.1.5**.
Download the connector from SMM and reload the unpacked extension after replacing its files.
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

Open **http://127.0.0.1:5173**. On the first visit, name your organization and choose
your username, email and password. Panda Store saves the organization and account
in this installation's database, stores a password hash, and opens the console.
Returning visits open the console while your session is valid; after signing out
or session expiry, sign in with the account you created. There is no cloud account
or email delivery during setup.
ASO and SMM are enabled in the new workspace, alongside the app catalog and Apple import.

The local configuration enables `PANDA_SETUP_ENABLED=true`. Setup can run only once.
To update an earlier alpha, add this setting to `.env` and run migrations: the
single seeded demo workspace can be renamed and claimed without losing its apps.
Installations with other existing accounts retain sign-in. The bootstrap script
preserves existing `.env` files; this file contains secrets and must never be published.

Choose **Connections → Try with demo apps**, import **Runclub**, then use the **SMM** to create
three directions from **Scripts → Demo templates · No AI**. You can also open **ASO → Run audit**
with **Rules only · No AI**. These two paths require no paid key. Browser research uses a
connected AI provider and the Chrome connector; its billing and coverage limits are shown
before it starts. The initial workspace is empty so you can try the actual import
flow. Local development uses SQLite and a background worker: no Redis service,
external account or paid AI key is required. Keep the worker terminal running;
restart it after changing backend code. After updating an existing installation,
install the requirements and run migrations before restarting these processes.

For Apple imports, follow [Connections](connections.md). For research, install the [SMM browser connector](smm.md#social-research-in-your-browser).
