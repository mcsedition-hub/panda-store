import uuid

from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.debug import sensitive_post_parameters, sensitive_variables
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.response import Response

from addons.app_catalog.serializers import AppSerializer
from addons.app_catalog.services import import_app
from panda_store.core.access import workspace_access
from panda_store.core.credentials import credentials_ready, encrypt

from .client import AppleClient
from .connector import DemoAppleConnector
from .models import AppleAppBinding, AppleConnection
from .serializers import AppImportInput, CatalogQuery, ConnectionInput, ConnectionSerializer
from .services import import_from_connection, lock_connection


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


@sensitive_post_parameters()
@api_view(["GET", "POST"])
def connections(request, workspace_id):
    workspace = workspace_access(
        request.user, workspace_id, owner=request.method == "POST", module="apple_store"
    )
    if request.method == "GET":
        items = AppleConnection.objects.filter(workspace=workspace)
        return Response(
            {
                "connections": ConnectionSerializer(items, many=True).data,
                "credentials_ready": credentials_ready(),
            }
        )
    return save_connection(request, workspace)


@sensitive_variables()
def save_connection(request, workspace, existing=None):
    data = ConnectionInput(data=request.data)
    data.is_valid(raise_exception=True)
    values = dict(data.validated_data)
    private_key = values.pop("private_key")
    encrypted_key = encrypt(private_key)
    duplicate = AppleConnection.objects.filter(workspace=workspace, key_id=values["key_id"])
    if existing:
        duplicate = duplicate.exclude(pk=existing.pk)
    if duplicate.exists():
        raise serializers.ValidationError("This API key is already connected to this workspace.")
    with AppleClient(
        **{key: values[key] for key in ("key_id", "key_type", "issuer_id")}, private_key=private_key
    ) as client:
        client.list_apps()
    try:
        with transaction.atomic():
            connection = (
                lock_connection(existing) if existing else AppleConnection(workspace=workspace)
            )
            for name, value in values.items():
                setattr(connection, name, value)
            connection.encrypted_private_key = encrypted_key
            connection.revision = uuid.uuid4()
            connection.last_checked_at = timezone.now()
            connection.save()
    except IntegrityError:
        raise serializers.ValidationError(
            "This API key is already connected to this workspace."
        ) from None
    return Response(ConnectionSerializer(connection).data, status=200 if existing else 201)


@sensitive_post_parameters()
@api_view(["PUT", "DELETE"])
def connection_detail(request, workspace_id, connection_id):
    workspace = workspace_access(request.user, workspace_id, owner=True, module="apple_store")
    connection = get_object_or_404(AppleConnection, pk=connection_id, workspace=workspace)
    if request.method == "PUT":
        return save_connection(request, workspace, connection)
    with transaction.atomic():
        current = lock_connection(connection)
        from addons.app_catalog.models import MobileApp

        MobileApp.objects.filter(apple_binding__connection=current).update(
            sync_provider="", last_sync_error=""
        )
        current.delete()
    return Response(status=204)


@api_view(["GET"])
def connection_apps(request, workspace_id, connection_id):
    workspace = workspace_access(request.user, workspace_id, module="apple_store")
    connection = get_object_or_404(AppleConnection, pk=connection_id, workspace=workspace)
    query = CatalogQuery(data=request.query_params)
    query.is_valid(raise_exception=True)
    with AppleClient.from_connection(connection) as client:
        catalog = client.list_apps(query.validated_data.get("cursor"))
    AppleConnection.objects.filter(pk=connection.pk, revision=connection.revision).update(
        last_checked_at=timezone.now()
    )
    return Response(catalog)


@api_view(["POST"])
def import_live(request, workspace_id, connection_id):
    workspace = workspace_access(request.user, workspace_id, write=True, module="apple_store")
    connection = get_object_or_404(AppleConnection, pk=connection_id, workspace=workspace)
    data = AppImportInput(data=request.data)
    data.is_valid(raise_exception=True)
    app, created = import_from_connection(connection, data.validated_data["external_id"])
    return Response(AppSerializer(app).data, status=201 if created else 200)


@api_view(["POST"])
def sync_app(request, workspace_id, app_id):
    workspace = workspace_access(request.user, workspace_id, write=True, module="apple_store")
    binding = get_object_or_404(
        AppleAppBinding.objects.select_related("connection", "app"),
        app_id=app_id,
        app__workspace=workspace,
        connection__workspace=workspace,
    )
    app, _ = import_from_connection(
        binding.connection, binding.app.external_id, expected_app=binding.app
    )
    return Response(AppSerializer(app).data)
