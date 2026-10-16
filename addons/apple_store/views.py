from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.response import Response

from addons.app_catalog.serializers import AppSerializer
from addons.app_catalog.services import import_app
from panda_store.core.access import workspace_access

from .connector import DemoAppleConnector


class ImportRequest(serializers.Serializer):
    external_id = serializers.CharField(max_length=200)


@api_view(["GET"])
def catalog(request, workspace_id):
    workspace_access(request.user, workspace_id, module="apple_store")
    return Response({"mode": "demo", "apps": DemoAppleConnector().list_apps()})


@api_view(["POST"])
def import_demo(request, workspace_id):
    workspace = workspace_access(request.user, workspace_id, write=True, module="apple_store")
    data = ImportRequest(data=request.data)
    data.is_valid(raise_exception=True)
    metadata = DemoAppleConnector().get_metadata(data.validated_data["external_id"])
    app, created = import_app(workspace, metadata=metadata, source="demo.apple_store", is_demo=True)
    return Response(AppSerializer(app).data, status=201 if created else 200)
