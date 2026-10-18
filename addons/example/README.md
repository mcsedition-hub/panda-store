# Example module

This module is a developer reference. It remains in the repository but is hidden
from navigation and the Modules screen. To create a visible extension, copy it under
a new identifier by following the [module guide](../../docs/modules.md).

The example includes a React page and the Django route
`GET /api/workspaces/<uuid>/example/hello/`, protected by workspace membership
and module activation.

It declares its dependency on `app_catalog` in `module.json` and adds no table.
It uses the same registry and access controls as the business modules.
