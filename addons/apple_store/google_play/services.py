import json
import uuid
from contextlib import contextmanager
from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import APIException

from addons.app_catalog.models import MobileApp
from addons.app_catalog.services import import_app
from panda_store.core.access import workspace_access
from panda_store.core.credentials import decrypt

from ..models import GooglePlayAppBinding, GooglePlayConnection, GooglePlayLease
from ..services import ConnectionChanged
from .client import GooglePlayClient, GooglePlayError


class AccountBusy(APIException):
    status_code = 409
    default_detail = (
        "Another Google Play request is using this service account. "
        "Wait for it to finish, then retry."
    )


@contextmanager
def checked_client(credentials):
    token, now = uuid.uuid4(), timezone.now()
    email = credentials["client_email"]
    expires = now + timedelta(seconds=90)
    _, created = GooglePlayLease.objects.get_or_create(
        client_email=email, defaults={"token": token, "expires_at": expires}
    )
    if not created and not GooglePlayLease.objects.filter(
        client_email=email, expires_at__lte=now
    ).update(token=token, expires_at=expires):
        raise AccountBusy()
    try:
        with GooglePlayClient(credentials) as client:
            yield client
    finally:
        GooglePlayLease.objects.filter(client_email=email, token=token).delete()


def lock_connection(connection):
    current = (
        GooglePlayConnection.objects.select_for_update()
        .filter(
            pk=connection.pk, workspace_id=connection.workspace_id, revision=connection.revision
        )
        .first()
    )
    if current is None:
        raise ConnectionChanged()
    return current


def import_from_connection(connection, package_name, *, user, expected_app=None):
    try:
        with checked_client(json.loads(decrypt(connection.encrypted_credentials))) as client:
            metadata = client.get_metadata(package_name)
    except GooglePlayError as exc:
        if expected_app is not None:
            MobileApp.objects.filter(
                pk=expected_app.pk,
                google_play_binding__connection=connection,
                google_play_binding__connection__revision=connection.revision,
            ).update(last_sync_error=str(exc.detail)[:300])
        raise
    with transaction.atomic():
        workspace_access(user, connection.workspace_id, write=True, module="apple_store")
        current = lock_connection(connection)
        MobileApp.objects.select_for_update().filter(
            workspace_id=current.workspace_id, platform="android", external_id=package_name
        ).first()
        if (
            expected_app is not None
            and not GooglePlayAppBinding.objects.filter(
                app=expected_app, connection=current
            ).exists()
        ):
            raise ConnectionChanged()
        app, created = import_app(
            current.workspace, metadata=metadata, source="google_play.api", is_demo=False
        )
        GooglePlayAppBinding.objects.update_or_create(app=app, defaults={"connection": current})
        app.sync_provider = "google_play"
        app.last_synced_at = timezone.now()
        app.last_sync_error = ""
        app.save(update_fields=["sync_provider", "last_synced_at", "last_sync_error"])
        current.last_checked_at = app.last_synced_at
        current.save(update_fields=["last_checked_at"])
    return app, created
