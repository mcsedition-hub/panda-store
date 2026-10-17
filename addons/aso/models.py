import uuid

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
