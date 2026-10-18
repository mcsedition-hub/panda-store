import json
import uuid

from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.debug import sensitive_post_parameters, sensitive_variables
from rest_framework.decorators import api_view
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from addons.app_catalog.models import MobileApp
from addons.app_catalog.serializers import AppSerializer
from panda_store.core.access import workspace_access
from panda_store.core.credentials import credentials_ready, encrypt

from ..models import GooglePlayAppBinding, GooglePlayConnection
from ..services import ConnectionChanged
from .serializers import AppImportInput, ConnectionInput, ConnectionSerializer
from .services import checked_client, import_from_connection, lock_connection


@sensitive_post_parameters()
@api_view(["GET", "POST"])
def connections(request, workspace_id):
    workspace = workspace_access(
        request.user, workspace_id, owner=request.method == "POST", module="apple_store"
    )
    if request.method == "GET":
        return Response(
            {
                "connections": ConnectionSerializer(
                    GooglePlayConnection.objects.filter(workspace=workspace), many=True
                ).data,
                "credentials_ready": credentials_ready(),
            }
        )
    return save_connection(request, workspace)


@sensitive_variables()
def save_connection(request, workspace, existing=None):
    data = ConnectionInput(data=request.data)
    data.is_valid(raise_exception=True)
    values = data.validated_data
    if (existing.revision if existing else None) != values.get("revision"):
        raise ConnectionChanged()
    credentials = values["service_account_json"]
    encrypted = encrypt(json.dumps(credentials))
    duplicate = GooglePlayConnection.objects.filter(
        workspace=workspace, client_email=credentials["client_email"]
    )
    if existing:
        duplicate = duplicate.exclude(pk=existing.pk)
    if duplicate.exists():
        raise ValidationError("This Google service account is already connected to this workspace.")
    with checked_client(credentials) as client:
        client.get_metadata(values["package_name"], include_images=False)
    try:
        with transaction.atomic():
            workspace_access(request.user, workspace.pk, owner=True, module="apple_store")
            connection = (
                lock_connection(existing) if existing else GooglePlayConnection(workspace=workspace)
            )
            connection.name = values["name"]
            connection.client_email = credentials["client_email"]
            connection.project_id = credentials["project_id"]
            connection.verified_package = values["package_name"]
            connection.encrypted_credentials = encrypted
            connection.revision = uuid.uuid4()
            connection.last_checked_at = timezone.now()
            connection.save()
    except IntegrityError:
        raise ValidationError(
            "This Google service account is already connected to this workspace."
        ) from None
    return Response(ConnectionSerializer(connection).data, status=200 if existing else 201)


@sensitive_post_parameters()
@api_view(["PUT", "DELETE"])
def connection_detail(request, workspace_id, connection_id):
    workspace = workspace_access(request.user, workspace_id, owner=True, module="apple_store")
    connection = get_object_or_404(GooglePlayConnection, pk=connection_id, workspace=workspace)
    if request.method == "PUT":
        return save_connection(request, workspace, connection)
    with transaction.atomic():
        current = lock_connection(connection)
        MobileApp.objects.filter(google_play_binding__connection=current).update(
            sync_provider="", last_sync_error=""
        )
        current.delete()
    return Response(status=204)


@api_view(["GET"])
def connection_apps(request, workspace_id, connection_id):
    workspace = workspace_access(request.user, workspace_id, module="apple_store")
    connection = get_object_or_404(GooglePlayConnection, pk=connection_id, workspace=workspace)
    apps = MobileApp.objects.filter(
        workspace=workspace, google_play_binding__connection=connection
    ).prefetch_related("snapshots")
    return Response({"apps": AppSerializer(apps, many=True).data})


@api_view(["POST"])
def import_live(request, workspace_id, connection_id):
    workspace = workspace_access(request.user, workspace_id, write=True, module="apple_store")
    connection = get_object_or_404(GooglePlayConnection, pk=connection_id, workspace=workspace)
    data = AppImportInput(data=request.data)
    data.is_valid(raise_exception=True)
    app, created = import_from_connection(
        connection, data.validated_data["package_name"], user=request.user
    )
    return Response(AppSerializer(app).data, status=201 if created else 200)


@api_view(["POST"])
def sync_app(request, workspace_id, app_id):
    workspace = workspace_access(request.user, workspace_id, write=True, module="apple_store")
    binding = get_object_or_404(
        GooglePlayAppBinding.objects.select_related("connection", "app"),
        app_id=app_id,
        app__workspace=workspace,
        connection__workspace=workspace,
    )
    app, _ = import_from_connection(
        binding.connection, binding.app.external_id, user=request.user, expected_app=binding.app
    )
    return Response(AppSerializer(app).data)
