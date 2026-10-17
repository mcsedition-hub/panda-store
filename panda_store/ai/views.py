import uuid

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from panda_store.core.access import workspace_access
from panda_store.core.credentials import credentials_ready, decrypt, encrypt
from panda_store.core.models import AIConnection, Workspace

from .providers import PROVIDERS, ProviderError, list_models


class ConnectionRequest(serializers.Serializer):
    api_key = serializers.CharField(min_length=10, max_length=1000, required=False, write_only=True)
    revision = serializers.UUIDField(required=False, allow_null=True)


def catalog(workspace):
    connections = {item.provider: item for item in workspace.ai_connections.all()}
    return {
        "credentials_ready": credentials_ready(),
        "providers": [
            {
                "id": provider,
                "name": name,
                "connected": provider in connections,
                "revision": str(connections[provider].revision)
                if provider in connections
                else None,
                "models": connections[provider].model_catalog if provider in connections else [],
                "checked_at": connections[provider].checked_at if provider in connections else None,
            }
            for provider, name in PROVIDERS.items()
        ],
    }


@api_view(["GET"])
def connections(request, workspace_id):
    workspace = workspace_access(request.user, workspace_id)
    return Response(catalog(workspace))


@api_view(["PUT", "POST", "DELETE"])
def connection(request, workspace_id, provider):
    workspace = workspace_access(request.user, workspace_id, owner=True)
    if provider not in PROVIDERS:
        raise ValidationError("Choose a supported AI provider.")
    data = ConnectionRequest(data=request.data)
    data.is_valid(raise_exception=True)
    values = data.validated_data
    original = AIConnection.objects.filter(workspace=workspace, provider=provider).first()
    if (original.revision if original else None) != values.get("revision"):
        return Response({"error": "This connection changed. Reload AI settings."}, status=409)
    if request.method == "PUT" and not values.get("api_key"):
        raise ValidationError("Enter an API key.")
    if request.method in {"POST", "DELETE"} and not original:
        raise ValidationError("Connect this provider first.")
    encrypted = None
    models = None
    if request.method != "DELETE":
        key = values["api_key"] if request.method == "PUT" else decrypt(original.encrypted_key)
        encrypted = encrypt(key)
        try:
            models = list_models(provider, key)
        except ProviderError as exc:
            raise ValidationError(str(exc)) from None
    with transaction.atomic():
        Workspace.objects.select_for_update().get(pk=workspace.pk)
        workspace_access(request.user, workspace_id, owner=True)
        current = AIConnection.objects.filter(workspace=workspace, provider=provider).first()
        if (current.pk if current else None) != (original.pk if original else None) or (
            current.revision if current else None
        ) != values.get("revision"):
            return Response({"error": "This connection changed. Reload AI settings."}, status=409)
        if request.method == "DELETE":
            current.delete()
        else:
            current = current or AIConnection(workspace=workspace, provider=provider)
            if request.method == "PUT":
                current.encrypted_key = encrypted
                current.revision = uuid.uuid4()
            current.model_catalog = models
            current.checked_at = timezone.now()
            current.save()
    return Response(catalog(workspace))
