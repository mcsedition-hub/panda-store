"""Explicit provider/model selection for a linked retry; never automatic fallback."""

from rest_framework import serializers
from rest_framework.exceptions import ValidationError

from panda_store.core.models import AIConnection

from .providers import PROVIDERS, ProviderError, check_capabilities


class AIRetryRequest(serializers.Serializer):
    request_id = serializers.UUIDField()
    provider = serializers.ChoiceField(choices=list(PROVIDERS), required=False)
    model = serializers.CharField(max_length=120, required=False)

    def validate(self, attrs):
        if ("provider" in attrs) != ("model" in attrs):
            raise ValidationError("Choose both a provider and a model for this retry.")
        return attrs


def matches_retry_choice(actual, original, values):
    requested = values if "provider" in values else original or {}
    return all((actual or {}).get(key) == requested.get(key) for key in ("provider", "model"))


def retry_choice(workspace, original, values, *, images=False):
    if "provider" not in values:
        return original
    if not original:
        raise ValidationError("Start a new AI audit to add a model to a rules-only audit.")
    connection = AIConnection.objects.filter(
        workspace=workspace, provider=values["provider"]
    ).first()
    if not connection or values["model"] not in [m["id"] for m in connection.model_catalog]:
        raise ValidationError("Connect the provider and choose an available model in AI settings.")
    try:
        check_capabilities(connection.provider, values["model"], images=images)
    except ProviderError as exc:
        raise ValidationError(str(exc)) from None
    return {
        **original,
        "provider": connection.provider,
        "model": values["model"],
        "connection_id": str(connection.pk),
        "revision": str(connection.revision),
    }
