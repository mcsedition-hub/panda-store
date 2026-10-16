from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import APIException

from addons.app_catalog.models import MobileApp
from addons.app_catalog.services import import_app

from .client import AppleClient, AppleError
from .models import AppleAppBinding, AppleConnection


class ConnectionChanged(APIException):
    status_code = 409
    default_detail = "This connection changed during the request. Reload and try again."


def lock_connection(connection):
    current = (
        AppleConnection.objects.select_for_update()
        .filter(
            pk=connection.pk, workspace_id=connection.workspace_id, revision=connection.revision
        )
        .first()
    )
    if current is None:
        raise ConnectionChanged()
    return current


def import_from_connection(connection, external_id, *, expected_app=None):
    try:
        with AppleClient.from_connection(connection) as client:
            metadata = client.get_metadata(external_id)
    except AppleError as exc:
        if expected_app is not None:
            MobileApp.objects.filter(
                pk=expected_app.pk,
                apple_binding__connection=connection,
                apple_binding__connection__revision=connection.revision,
            ).update(last_sync_error=str(exc.detail))
        raise
    with transaction.atomic():
        current = lock_connection(connection)
        # All imports lock the app before checking or changing its account binding.
        MobileApp.objects.select_for_update().filter(
            workspace_id=current.workspace_id, platform="ios", external_id=external_id
        ).first()
        if (
            expected_app is not None
            and not AppleAppBinding.objects.filter(app=expected_app, connection=current).exists()
        ):
            raise ConnectionChanged()
        app, created = import_app(
            current.workspace, metadata=metadata, source="apple_store.api", is_demo=False
        )
        AppleAppBinding.objects.update_or_create(app=app, defaults={"connection": current})
        app.sync_provider = "apple_store"
        app.last_synced_at = timezone.now()
        app.last_sync_error = ""
        app.save(update_fields=["sync_provider", "last_synced_at", "last_sync_error"])
        current.last_checked_at = app.last_synced_at
        current.save(update_fields=["last_checked_at"])
    return app, created
