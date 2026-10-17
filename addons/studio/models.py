import uuid

from django.conf import settings
from django.db import models

from addons.app_catalog.models import MobileApp
from panda_store.core.models import Workspace


class Brief(models.Model):
    app = models.OneToOneField(MobileApp, on_delete=models.CASCADE, related_name="brief")
    audience = models.CharField(max_length=500, blank=True)
    goal = models.CharField(max_length=500, default="Encourage people to try the app.")
    tone = models.CharField(max_length=80, default="Clear and friendly")
    research = models.ForeignKey("ResearchRun", null=True, blank=True, on_delete=models.SET_NULL)
    research_page_ids = models.JSONField(default=list)
    product_facts = models.TextField(blank=True)
    language = models.CharField(max_length=40, default="English")
    duration_seconds = models.PositiveSmallIntegerField(default=30)
    updated_at = models.DateTimeField(auto_now=True)


class GenerationRun(models.Model):
    class Status(models.TextChoices):
        QUEUED = "queued"
        RUNNING = "running"
        SUCCEEDED = "succeeded"
        FAILED = "failed"
        CANCELING = "canceling"
        CANCELED = "canceled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE)
    workflow = models.OneToOneField(
        "workflows.WorkflowRun", null=True, on_delete=models.SET_NULL, related_name="generation"
    )
    app = models.ForeignKey(MobileApp, on_delete=models.CASCADE, related_name="runs")
    request_id = models.UUIDField()
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.QUEUED)
    provider = models.CharField(max_length=40, default="demo_templates")
    request = models.JSONField(default=dict)
    review = models.JSONField(default=dict)
    inputs = models.JSONField()
    error = models.CharField(max_length=300, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "request_id"],
                name="unique_generation_request",
            )
        ]


class Creative(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    run = models.ForeignKey(GenerationRun, on_delete=models.CASCADE, related_name="creatives")
    variant = models.PositiveSmallIntegerField()
    angle = models.CharField(max_length=100)
    hook = models.CharField(max_length=500)
    script = models.TextField(max_length=6000)
    cta = models.CharField(max_length=300)
    provenance = models.JSONField(default=dict)
    approved = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["variant"]
        constraints = [models.UniqueConstraint(fields=["run", "variant"], name="unique_variant")]


class SceneAsset(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    app = models.ForeignKey(MobileApp, on_delete=models.CASCADE, related_name="scene_assets")
    source_key = models.CharField(max_length=64)
    metadata = models.JSONField()
    data = models.BinaryField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(fields=["app", "source_key"], name="unique_scene_asset_source")
        ]


class Storyboard(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    creative = models.OneToOneField(Creative, on_delete=models.CASCADE, related_name="storyboard")
    source = models.JSONField()
    scenes = models.JSONField()
    version = models.PositiveIntegerField(default=1)
    updated_at = models.DateTimeField(auto_now=True)


class StoryboardRevision(models.Model):
    board = models.ForeignKey(Storyboard, on_delete=models.CASCADE, related_name="revisions")
    version = models.PositiveIntegerField()
    scenes = models.JSONField()
    request_id = models.UUIDField(default=uuid.uuid4)
    operation = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-version"]
        constraints = [
            models.UniqueConstraint(fields=["board", "version"], name="unique_storyboard_version"),
            models.UniqueConstraint(
                fields=["board", "request_id"], name="unique_storyboard_request"
            ),
        ]


class ResearchRun(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE)
    app = models.ForeignKey(MobileApp, on_delete=models.CASCADE, related_name="research_runs")
    workflow = models.OneToOneField("workflows.WorkflowRun", on_delete=models.CASCADE)
    evidence_root = models.ForeignKey("self", on_delete=models.CASCADE, null=True)
    request_id = models.UUIDField()
    request = models.JSONField()
    inputs = models.JSONField()
    report = models.JSONField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "request_id"], name="unique_research_request"
            )
        ]


class ResearchPage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    run = models.ForeignKey(ResearchRun, on_delete=models.CASCADE, related_name="pages")
    position = models.PositiveSmallIntegerField()
    source = models.JSONField()
    final_url = models.URLField(max_length=2500, blank=True)
    title = models.CharField(max_length=300, blank=True)
    status = models.CharField(max_length=20)
    reason = models.CharField(max_length=500, blank=True)
    text = models.TextField(blank=True)
    trace = models.JSONField(default=list)
    top_image = models.BinaryField(null=True)
    scroll_image = models.BinaryField(null=True)
    hashes = models.JSONField(default=dict)
    captured_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["position"]
        constraints = [
            models.UniqueConstraint(fields=["run", "position"], name="unique_research_page")
        ]
