from django.contrib import admin
from django.urls import include, path

from .core import auth, views
from .core.registry import get_registry

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", views.health),
    path("api/session/", auth.session),
    path("api/session/local/", auth.enter_local_workspace),
    path("api/session/login/", auth.sign_in),
    path("api/session/logout/", auth.sign_out),
    path("api/workspaces/", views.workspaces),
    path("api/workspaces/<uuid:workspace_id>/modules/", views.modules),
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
