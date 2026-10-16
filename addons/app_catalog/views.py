from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view
from rest_framework.response import Response

from panda_store.core.access import workspace_access

from .models import MobileApp
from .serializers import AppSerializer


@api_view(["GET"])
def app_list(request, workspace_id):
    workspace = workspace_access(request.user, workspace_id, module="app_catalog")
    apps = MobileApp.objects.filter(workspace=workspace).prefetch_related("snapshots")
    return Response(AppSerializer(apps, many=True).data)


@api_view(["GET"])
def app_detail(request, workspace_id, app_id):
    workspace = workspace_access(request.user, workspace_id, module="app_catalog")
    app = get_object_or_404(
        MobileApp.objects.prefetch_related("snapshots"),
        workspace=workspace,
        pk=app_id,
    )
    return Response(AppSerializer(app).data)
