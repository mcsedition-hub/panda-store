# Connections

[Documentation](README.md)

Import your apps from Apple and connect your own AI providers.

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

## AI providers

Open **AI settings** from ASO or SMM to connect OpenAI, Google Gemini or Anthropic Claude. The workspace owner manages the keys. Choose a model before starting an AI task; usage is billed to that provider account. See [model selection and recovery](aso.md#choose-an-ai-model).
