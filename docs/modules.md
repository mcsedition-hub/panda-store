# Developing a module

The module contract is experimental throughout the 0.1 series.
[`addons/example`](../addons/example) provides a complete minimal module. It is a
developer reference and remains hidden in the interface, including the Modules
screen. Copy it under a new identifier to create your extension.

The first public version includes two business modules: **ASO** and **SMM**.
The catalogue, Apple, Google Play and AI connections, and workflows provide their
shared foundation; the example module illustrates the extension contract. The
priority is to finish these two flows before choosing a third business module.
Social account connections for publishing and scheduling are reserved for the
future cloud offering. The research browser connector remains part of community SMM.
See the [scope and release criteria](roadmap.md).

## Structure

```text
addons/my_module/
  __init__.py
  apps.py
  module.json
  urls.py
  models.py                if the module stores data
  migrations/              versioned Django migrations
  frontend/index.tsx       default export of a ModuleProps component
  tests/                   module permissions, data and behavior
```

A manifest:

```json
{
  "id": "my_module",
  "name": "My module",
  "version": "0.1.0",
  "core": ">=0.1,<0.2",
  "depends": {"app_catalog": ">=0.1,<0.2"},
  "family": "lichen",
  "icon": "extensions",
  "description": "What this module enables users to do.",
  "capabilities": ["my_module.read"]
}
```

Version constraints use `packaging.SpecifierSet` syntax. Available families are
frost, coral and lichen. `icon` refers to a local asset at
`web/public/modules/<icon>.webp`. Capabilities are descriptive declarations,
not automatically enforced permissions.

`availability` defaults to `available`. The `planned` value shows an upcoming module
in the catalogue and prohibits activation, including as a dependency. A required
module cannot be planned. ASO is available; a new module without executable features
can use this status during design.

## Installation and activation

1. Add the module under `addons/` with an ID matching its folder name. This convention
   connects the server manifest to the component discovered by Vite.
2. Add its Python path to `PANDA_MODULE_PACKAGES` in `.env`, retaining required modules.
   This variable replaces the entire list.
3. Create its migrations, run `manage.py migrate`, rebuild the interface, then restart
   the server and workers.
4. Each workspace owner can activate it. Dependencies are activated together.
   Deactivation preserves existing data.

External Python packages without an interface can use the same registry. Interfaces
from external packages currently need to be included in the build under `addons/`.
There is no runtime installation from a marketplace.

## Routes and access

Routes are mounted automatically under
`/api/workspaces/<workspace_id>/<module_id>/`.

Every endpoint must call `workspace_access(request.user, workspace_id,
module="my_module")`, with `write=True` for data changes. It must then filter
**all** object lookups by that workspace. A React button does not provide server
authorization.

Do not store secrets in manifests, API responses or frontend sources. Do not load
modules from another workspace based on their UUID alone. Dependencies must declare
imports between modules. Updates must preserve data or provide an explicit migration.

## Interface

The component receives `ModuleProps`, defined in `web/src/contracts.ts`: workspace,
available apps, selected app and selection/navigation callbacks.
The `navigate(module, appId?, page?)` callback can also open a module page, such as
`import` for Connections. The component receives it in `page`.
`web/src/api.ts` sends the session and CSRF token with API calls. Modules are loaded
on demand in the React shell and independently checked on the server.

Before distributing or proposing a module, read the [contribution policy](../CONTRIBUTING.md)
and [license terms](licensing.md). A third-party module does not automatically gain
a place in the official cloud offering.

## Workflow tracking

The `panda_store.workflows` foundation is available to installed modules.
SMM provides the first example in `addons/studio/workflow.py` and `tasks.py`:
versioned creation, ordered steps and dependencies, actions actually performed
and saved results. The local worker expects a dictionary
`RUNNERS = {workflow_key: (version, execute)}` in the installed package's `workflow.py`;
`execute` receives the execution UUID. Compose can dispatch the same work through Celery.

Transition functions require the lease obtained through `claim`. Keep business writes
and step completion in a transaction protected by `execution_lock`. Emit controlled
messages, never keys or raw tool responses. Step outputs are private checkpoints;
the shared API does not expose them. The adapter remains responsible for freezing
inputs and checking that a retry can reuse results without repeating external effects.
The shared panel is `web/src/workflows/WorkflowPanel.tsx`. Its initial view is
sequential; parallel scheduling and a visual editor are planned.
