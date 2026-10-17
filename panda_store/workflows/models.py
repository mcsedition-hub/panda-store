import uuid

from django.conf import settings
from django.db import models

from panda_store.core.models import Workspace


class WorkflowRun(models.Model):
    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        RUNNING = "running", "Running"
        CANCELING = "canceling", "Canceling"
        SUCCEEDED = "succeeded", "Completed"
        FAILED = "failed", "Failed"
        CANCELED = "canceled", "Canceled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE)
    module_id = models.CharField(max_length=64)
    workflow_key = models.CharField(max_length=100)
    version = models.PositiveSmallIntegerField(default=1)
    title = models.CharField(max_length=160)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.QUEUED)
    # One successor per attempt makes a double-click on retry idempotent.
    retry_of = models.OneToOneField(
        "self", null=True, on_delete=models.SET_NULL, related_name="retry_run"
    )
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True)
    completed_at = models.DateTimeField(null=True)
    heartbeat_at = models.DateTimeField(null=True)
    lease_token = models.UUIDField(null=True, editable=False)
    lease_expires_at = models.DateTimeField(null=True)
    error = models.CharField(max_length=300, blank=True)
    event_sequence = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["status", "lease_expires_at"])]

    @property
    def terminal(self):
        return self.status in {self.Status.SUCCEEDED, self.Status.FAILED, self.Status.CANCELED}


class StepRun(models.Model):
    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        RUNNING = "running", "Running"
        SUCCEEDED = "succeeded", "Completed"
        FAILED = "failed", "Failed"
        CANCELED = "canceled", "Canceled"
        SKIPPED = "skipped", "Skipped"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    run = models.ForeignKey(WorkflowRun, on_delete=models.CASCADE, related_name="steps")
    key = models.SlugField(max_length=64)
    title = models.CharField(max_length=100)
    kind = models.CharField(max_length=40)
    position = models.PositiveSmallIntegerField()
    depends_on = models.JSONField(default=list)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.QUEUED)
    reused_from = models.ForeignKey("self", null=True, on_delete=models.SET_NULL)
    summary = models.CharField(max_length=300, blank=True)
    # Private checkpoint; never serialized to the activity API.
    output = models.JSONField(null=True)
    started_at = models.DateTimeField(null=True)
    completed_at = models.DateTimeField(null=True)

    class Meta:
        ordering = ["position"]
        constraints = [models.UniqueConstraint(fields=["run", "key"], name="unique_workflow_step")]


class RunEvent(models.Model):
    run = models.ForeignKey(WorkflowRun, on_delete=models.CASCADE, related_name="events")
    sequence = models.PositiveIntegerField()
    step_key = models.SlugField(max_length=64, blank=True)
    kind = models.CharField(max_length=40)
    message = models.CharField(max_length=300)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["sequence"]
        constraints = [
            models.UniqueConstraint(fields=["run", "sequence"], name="unique_workflow_event")
        ]
