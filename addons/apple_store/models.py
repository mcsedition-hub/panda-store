import uuid

from django.db import models

from addons.app_catalog.models import MobileApp
from panda_store.core.models import Workspace


class AppleConnection(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE)
    name = models.CharField(max_length=100)
    key_type = models.CharField(
        max_length=10, choices=[("team", "Team"), ("individual", "Individual")]
    )
    key_id = models.CharField(max_length=10)
    issuer_id = models.CharField(max_length=36, blank=True)
    encrypted_private_key = models.TextField()
    revision = models.UUIDField(default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    last_checked_at = models.DateTimeField(null=True)

    class Meta:
        ordering = ["name", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "key_id"], name="unique_workspace_apple_key"
            )
        ]


class AppleAppBinding(models.Model):
    app = models.OneToOneField(MobileApp, on_delete=models.CASCADE, related_name="apple_binding")
    connection = models.ForeignKey(
        AppleConnection, on_delete=models.CASCADE, related_name="bindings"
    )


class GooglePlayConnection(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE)
    name = models.CharField(max_length=100)
    client_email = models.EmailField(max_length=254)
    project_id = models.CharField(max_length=200)
    verified_package = models.CharField(max_length=200)
    encrypted_credentials = models.TextField()
    revision = models.UUIDField(default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    last_checked_at = models.DateTimeField(null=True)

    class Meta:
        ordering = ["name", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "client_email"], name="unique_workspace_google_play_account"
            )
        ]


class GooglePlayAppBinding(models.Model):
    app = models.OneToOneField(
        MobileApp, on_delete=models.CASCADE, related_name="google_play_binding"
    )
    connection = models.ForeignKey(
        GooglePlayConnection, on_delete=models.CASCADE, related_name="bindings"
    )


class GooglePlayLease(models.Model):
    # Google allows one open edit per API user. Serialize this service account
    # across workspaces without holding a database transaction during network I/O.
    client_email = models.EmailField(max_length=254, primary_key=True)
    token = models.UUIDField()
    expires_at = models.DateTimeField()
