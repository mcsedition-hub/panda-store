from dataclasses import asdict

from django.conf import settings
from django.db import connection
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .access import activate_modules, deactivate_module, workspace_access
from .models import Membership
from .registry import get_registry


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        return Response({"status": "ok", "version": settings.PANDA_CORE_VERSION})
    except Exception:
        return Response({"status": "unavailable"}, status=503)


@api_view(["GET"])
def workspaces(request):
    memberships = Membership.objects.filter(user=request.user).select_related("workspace")
    return Response(
        [
            {
                "id": str(m.workspace_id),
                "name": m.workspace.name,
                "role": m.role,
            }
            for m in memberships.order_by("workspace__created_at")
        ]
    )


@api_view(["GET"])
def modules(request, workspace_id):
    workspace = workspace_access(request.user, workspace_id)
    enabled = set(workspace.modules.values_list("module_id", flat=True))
    registry = get_registry()
    return Response(
        [
            {
                **asdict(registry.modules[key]),
                "enabled": key in enabled and registry.modules[key].availability == "available",
            }
            for key in registry.order
        ]
    )


@api_view(["POST", "DELETE"])
def module_activation(request, workspace_id, module_id):
    workspace = workspace_access(request.user, workspace_id, owner=True)
    if request.method == "POST":
        activated = activate_modules(workspace, [module_id])
        return Response({"activated": activated})
    deactivate_module(workspace, module_id)
    return Response(status=204)
