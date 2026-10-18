# Security

This alpha is intended for local demonstrations and development. It should not yet
be exposed as a public service with customer data. App Store Connect, Google Play
and AI keys are encrypted in the database with Fernet and an installation-specific
key (`PANDA_CREDENTIAL_KEYS`), separate from Django's session signing key.

Existing controls include Django sessions, CSRF, roles, workspace filters, random
local secrets and manifest validation. Only a workspace owner can add, replace or
remove its Apple, Google Play and AI keys. Keys are never returned by the API or
placed in browser storage. The Apple connector uses two-minute ES256 JWTs restricted
to GET requests. It rejects redirects and pagination links to another host or path.
Import errors preserve the last snapshot; changing or deleting a connection during
an import prevents stale results from being saved.

Google Play uses a dedicated service account and an OAuth exchange with fixed Google
hosts. Reading listings requires creating and then deleting a temporary edit session.
No publication or listing change is sent. A new session can invalidate another session
owned by the same account: do not share this service account with a publishing tool.
A temporary lease prevents concurrent imports for the same account within this installation.

Back up the database and encryption keys separately. Do not replace an existing
encryption key on restart. To rotate keys, put the new key first in
`PANDA_CREDENTIAL_KEYS`, followed by the old key, separated by a comma. New writes
use the first key; retain old keys while credentials or backups still depend on them.
There is no bulk re-encryption tool yet. Disconnecting in Panda Store does not revoke
the key at Apple. The Compose proxy limits sign-in attempts; the API launched directly
with Uvicorn or `runserver` does not include this limit. The demo account is not a
Django administrator.

The local configuration enables `PANDA_SETUP_ENABLED=true` to create an organization
and its owner on first launch. Keep the localhost bindings provided for Vite, Uvicorn
and Compose: the first visitor can configure an empty installation. Setup is protected
by CSRF; a transaction and a unique record prevent a second setup. Only the old
non-administrator demo account, isolated in its predefined workspace, can be claimed;
other databases with existing accounts cannot be reset through this wizard.

Passwords use Django's validators and hashing. A workspace owner is not a Django
administrator. Sessions, roles and workspace isolation remain required after setup.
The former automatic passwordless access has been removed. Email is stored locally,
without verification or password recovery by email at this stage.

Before a public service: complete HTTPS and secure cookies, operational secret
management, invitations and revocations, distributed rate limits, observability,
audit logging, tested backups and restoration, task budgets and an isolation review.

Installed modules are trusted Python code. Do not install an unknown module without
review. Workflows detect expired leases after a worker stops and offer an explicit
retry of unfinished steps. They do not automatically repeat a paid AI call. ASO drafts
and storyboards detect version conflicts; concurrent edits of the same SMM script do
not yet have this control.

SMM research sends the confirmed app context, captured text and views of the research
tab to the selected AI provider. Social passwords and cookies are not exported. Web
sources are treated as untrusted data and cannot authorize arbitrary commands. See
the [connector limits](addons/studio/browser_extension/README.md).

Do not publish exploitable vulnerability details in an issue. Use **Report a
vulnerability** in the repository's Security tab if private reporting is enabled.
Otherwise, request a private reporting channel without details, secrets or customer
data. No response time is guaranteed for this alpha.
