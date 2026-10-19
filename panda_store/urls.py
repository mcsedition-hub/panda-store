from django.contrib import admin
from django.urls import include, path

from .ai import usage_views
from .ai import views as ai_views
from .core import auth, views
from .core.registry import get_registry

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", views.health),
    path("api/session/", auth.session),
    path("api/setup/", auth.setup),
    path("api/session/login/", auth.sign_in),
    path("api/session/logout/", auth.sign_out),
    path("api/session/preferences/", auth.preferences),
    path("api/workspaces/", views.workspaces),
    path("api/workspaces/<uuid:workspace_id>/ai-usage/", usage_views.dashboard),
    path("api/workspaces/<uuid:workspace_id>/ai-usage/limits/", usage_views.limits),
    path(
        "api/workspaces/<uuid:workspace_id>/ai-usage/<uuid:usage_id>/reconcile/",
        usage_views.reconcile,
    ),
    path("api/workspaces/<uuid:workspace_id>/ai/", ai_views.connections),
    path("api/workspaces/<uuid:workspace_id>/ai/<slug:provider>/", ai_views.connection),
    path("api/workspaces/<uuid:workspace_id>/modules/", views.modules),
    path("api/workspaces/<uuid:workspace_id>/workflows/", include("panda_store.workflows.urls")),
    path("api/workspaces/<uuid:workspace_id>/modules/<slug:module_id>/", views.module_activation),
]
for module_id in get_registry().order:
    module = get_registry().modules[module_id]
    urlpatterns.append(
        path(
            f"api/workspaces/<uuid:workspace_id>/{module_id}/",
            include(f"{module.package}.urls"),
        )
    )
