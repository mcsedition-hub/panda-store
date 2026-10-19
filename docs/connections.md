# Connections

[Documentation](README.md)

Import your apps from App Store Connect or Google Play and connect your own AI providers.

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
Connections lists your accounts without loading their app catalogues. In
**My apps → Import an app**, choose **App Store**, an account and one application.
Search by name or bundle ID, then choose **Import selected app**. Repeat this flow
whenever you want to add another app. Apps already imported can be opened directly.
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

## Connect Google Play

Open **Connections → Connect Google Play**. Enter a connection name, the app's
package name (for example `com.example.app`) and upload a service account JSON key.
Use a service account dedicated to this Panda Store installation. Gemini API keys
and OAuth client JSON files are not Google Play credentials.

In Google Cloud, enable the **Google Play Android Developer API**, create a service
account and download its JSON key. In **Play Console → Users and permissions**,
invite that service account's email and grant access to the apps you want to import.
Grant **View app information (read-only)** for each app. This permission was verified
with a real Play Console account for connection, listing and image import. No store
listing management, financial data, order access or production release permission
was needed. See Google's
[setup instructions](https://developers.google.com/android-publisher/getting_started)
and [permission guide](https://support.google.com/googleplay/android-developer/answer/9844686).

Connecting verifies access to the specified app before saving the encrypted key.
In **My apps → Import an app**, choose **Google Play**, an account and the package
name of the app to add, then choose **Import selected app**. You can add another app
later through the same flow. Google requires a package name because the publishing
API does not offer a developer's complete app catalogue. The app must already exist
in Play Console with an uploaded build and a store listing. Imported apps appear in
**My apps**; Connections only manages accounts and keys.

The importer reads localized titles, short descriptions and full descriptions. It
also imports the default language's icon, feature graphic and phone, tablet, TV and
Wear screenshots when available. Images are Google-hosted previews, not verified
original upload files. Category, release version, custom store listings, reviews,
installs and financial data are not imported. Android metadata is available in
**My apps**, **ASO** and **SMM**. ASO reviews the three Google Play text fields and
imported screenshots, and saves comparisons and drafts with Google Play guidance.
The Community SMM interface provides research and scripts; its Scenes tab is disabled.

Google requires a [temporary edit](https://developers.google.com/android-publisher/edits)
to read these resources. Panda Store creates that edit, reads its copy of the deployed
listing and deletes the edit without committing it. Creating an edit invalidates an
existing edit owned by the same service account, which is why that account must be
dedicated to Panda Store. Requests using the same service account are serialized
within this installation. Changes made in Play Console can interrupt an import;
wait until those changes finish, then retry.

**Refresh metadata** updates an imported app and saves a new snapshot only when its
content changes. An error preserves the previous snapshot. The owner manages keys;
editors can import and refresh; viewers can inspect saved apps. Disconnecting removes
the stored key and refresh binding while retaining imported data. Revoke a key in
Google Cloud to invalidate it there.

Imports have a 20-request / 40-second operation budget, plus a separate bounded
cleanup attempt. A failed cleanup reports an error instead of saving a partial
import. Redirects and publishing methods are rejected. Automated tests cover the
OAuth exchange, API contract, cleanup, permissions, stale connections and snapshot
preservation. A live Play Console validation on October 18, 2026 confirmed connection
and import of two localized listings, five phone screenshots and a feature graphic
using app-specific read-only access. Refresh preserved the existing snapshot when
the listing was unchanged. One refresh failed temporarily and succeeded on retry;
the previous snapshot remained available throughout.

## AI providers

Open **Settings → AI settings** in the sidebar to connect OpenAI, Google Gemini, Anthropic Claude or Z.ai (GLM). The workspace owner manages the keys. Choose a model before starting an AI task; usage belongs to that provider account. See [model selection and recovery](aso.md#choose-an-ai-model).

**Compare models by use** explains writing, ideas, reasoning and image analysis
across providers. Each provider initially shows up to five main models available
in your catalogue. **See more** reveals older models and dated versions. A model is
never selected automatically; collapsing the list preserves an explicit choice.
ASO and SMM each label one available, reviewed model **Recommended**, with a short
explanation. The recommendation considers the module and the task's image support.
It remains guidance; switching modules or expanding the list does not start a task.

Each reviewed profile links to official documentation and shows its review date.
Usage examples are editorial guidance, not an ASO ranking or a cross-provider
benchmark. Speed is relative within a provider and depends on inputs, outputs and
thinking effort. Unknown models remain selectable with unverified characteristics.
Profiles are maintained in `web/src/ai/modelProfiles.ts`; refreshing a connection
updates availability, not this reviewed guidance. Model IDs and documented dated
versions are matched explicitly, with no capability inference from future names.

The profile distinguishes reasoning support from the settings used by this app.
For example, GLM-5.3 uses low effort; other supported GLM models have thinking
disabled. GPT-5.4 uses the provider default, which currently disables thinking.
Image analysis means reading existing visuals. Image generation is not available
through this selector.

Guidance reviewed on October 18, 2026 using the official
[OpenAI model pages](https://developers.openai.com/api/docs/models),
[Gemini model pages](https://ai.google.dev/gemini-api/docs/models),
[Claude comparison](https://platform.claude.com/docs/en/models/overview) and
[Z.ai model documentation](https://docs.z.ai/guides/llm/glm-5.3).

### Z.ai (GLM)

Create a **Standard API Key** in [Z.ai](https://z.ai/manage-apikey/apikey-list),
choose **Provider → Z.ai (GLM)** in AI settings, paste the key and select
**Connect provider**. A GLM Coding Plan key is not suitable for this integration.
Panda Store uses the standard Z.ai API; no local model installation is required.

Connecting or refreshing sends a short connection check to `glm-4.7-flash`,
without app data. Z.ai currently lists this model as free. Panda Store maintains
the supported model catalogue; access to each other model is checked when used.
The selector identifies text and vision models and their listed pricing.
Consult [Z.ai pricing](https://docs.z.ai/guides/overview/pricing) for current
rates and limits; a new account does not make every GLM model free.

Use `glm-4.7-flash` for text audits and scripts, or `glm-4.6v-flash` for screenshot
reviews and SMM browser research. Both are listed as free at the time of integration.
Image tasks show only compatible GLM vision models. The older **Public-page
research (legacy)** flow does not support Z.ai; use **SMM → Research**.

GLM responses must pass local JSON Schema validation before they reach a task.
Incomplete or invalid responses produce an explicit error, without an automatic
retry or model change. Automated tests cover the API contract and workflow
integration; a successful connection check alone does not validate every model.

Live checks on October 18, 2026 (UTC) confirmed connection and structured text
output with `glm-4.7-flash`. Synthetic image checks with `glm-4.6v-flash` returned
Z.ai's temporary overload error (1305), so live vision validation remains pending.
No paid model was used for these checks.

## Usage and budgets

Open **AI usage** in the sidebar for tokens, estimated USD costs and optional workspace
limits across ASO and SMM. See [AI usage and limits](ai-usage.md) for reservations,
partial historical counters and the distinction from a provider account balance.
