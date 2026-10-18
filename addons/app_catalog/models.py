import uuid

from django.db import models

from panda_store.core.models import Workspace


class MobileApp(models.Model):
    class Platform(models.TextChoices):
        IOS = "ios", "App Store"
        ANDROID = "android", "Google Play"
        UNDECIDED = "undecided", "Not decided"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="apps")
    origin = models.CharField(
        max_length=10, choices=[("store", "Store"), ("project", "Project")], default="store"
    )
    name = models.CharField(max_length=200)
    platform = models.CharField(max_length=10, choices=Platform.choices)
    external_id = models.CharField(max_length=200)
    bundle_id = models.CharField(max_length=200, blank=True)
    is_demo = models.BooleanField(default=False)
    sync_provider = models.CharField(max_length=100, blank=True)
    last_synced_at = models.DateTimeField(null=True, blank=True)
    last_sync_error = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "platform", "external_id"],
                name="unique_workspace_store_app",
            )
        ]
        ordering = ["-created_at"]


class MetadataSnapshot(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    app = models.ForeignKey(MobileApp, on_delete=models.CASCADE, related_name="snapshots")
    data = models.JSONField()
    fingerprint = models.CharField(max_length=64)
    source = models.CharField(max_length=200)
    captured_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-captured_at"]
