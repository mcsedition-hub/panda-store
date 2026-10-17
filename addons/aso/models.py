import uuid

from django.conf import settings
from django.db import models


class AuditRun(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey("core.Workspace", on_delete=models.CASCADE)
    app = models.ForeignKey(
        "app_catalog.MobileApp", on_delete=models.CASCADE, related_name="aso_audits"
    )
    workflow = models.OneToOneField("workflows.WorkflowRun", on_delete=models.CASCADE)
    request_id = models.UUIDField()
    locale = models.CharField(max_length=35)
    # Immutable inputs and result: a refresh never rewrites an earlier audit.
    inputs = models.JSONField()
    report = models.JSONField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["workspace", "request_id"], name="unique_aso_request")
        ]


class ListingDraft(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey("core.Workspace", on_delete=models.CASCADE)
    app = models.ForeignKey(
        "app_catalog.MobileApp", on_delete=models.CASCADE, related_name="aso_drafts"
    )
    locale = models.CharField(max_length=35)
    name = models.CharField(max_length=120)
    inputs = models.JSONField()  # Frozen imported reference, including source and date.
    content = models.JSONField()
    provenance = models.JSONField(default=list)  # Selected findings, with their original sources.
    status = models.CharField(
        max_length=10, choices=[("draft", "Draft"), ("ready", "Ready")], default="draft"
    )
    version = models.PositiveIntegerField(default=1)
    request_id = models.UUIDField()
    create_request = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "request_id"], name="unique_aso_draft_request"
            )
        ]


class DraftRevision(models.Model):
    draft = models.ForeignKey(ListingDraft, on_delete=models.CASCADE, related_name="revisions")
    version = models.PositiveIntegerField()
    name = models.CharField(max_length=120)
    content = models.JSONField()
    status = models.CharField(max_length=10)
    request_id = models.UUIDField()
    operation = models.JSONField()
    reason = models.CharField(max_length=120)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-version"]
        constraints = [
            models.UniqueConstraint(fields=["draft", "version"], name="unique_aso_draft_version"),
            models.UniqueConstraint(
                fields=["draft", "request_id"], name="unique_aso_revision_request"
            ),
        ]
