import uuid

from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    language = models.CharField(
        max_length=2, choices=[("en", "English"), ("fr", "Français")], default="en"
    )


class Workspace(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class Installation(models.Model):
    """The singleton setup record, committed atomically with its owner and workspace."""

    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    owner = models.ForeignKey(User, on_delete=models.PROTECT, null=True)
    workspace = models.ForeignKey(Workspace, on_delete=models.PROTECT, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.CheckConstraint(condition=models.Q(id=1), name="one_installation")]


class Membership(models.Model):
    class Role(models.TextChoices):
        OWNER = "owner", "Owner"
        EDITOR = "editor", "Editor"
        VIEWER = "viewer", "Viewer"

    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.VIEWER)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["workspace", "user"], name="unique_member")]


class ModuleActivation(models.Model):
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="modules")
    module_id = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "module_id"],
                name="unique_workspace_module",
            )
        ]


class AIConnection(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(
        Workspace, on_delete=models.CASCADE, related_name="ai_connections"
    )
    provider = models.CharField(
        max_length=20,
        choices=[
            ("openai", "OpenAI"),
            ("google", "Google Gemini"),
            ("anthropic", "Anthropic Claude"),
            ("zai", "Z.ai (GLM)"),
        ],
    )
    encrypted_key = models.TextField()
    revision = models.UUIDField(default=uuid.uuid4, editable=False)
    model_catalog = models.JSONField(default=list)
    checked_at = models.DateTimeField(null=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["workspace", "provider"], name="unique_workspace_ai_provider"
            )
        ]


class AIBudget(models.Model):
    workspace = models.OneToOneField(Workspace, on_delete=models.CASCADE, primary_key=True)
    monthly_usd = models.DecimalField(max_digits=14, decimal_places=6, null=True, blank=True)
    operation_usd = models.DecimalField(max_digits=14, decimal_places=6, null=True, blank=True)
    monthly_tokens = models.PositiveBigIntegerField(null=True, blank=True)
    operation_tokens = models.PositiveBigIntegerField(null=True, blank=True)
    revision = models.UUIDField(default=uuid.uuid4, editable=False)
    lock_version = models.PositiveBigIntegerField(default=0)
    tracking_started_at = models.DateTimeField(auto_now_add=True)


class AIUsage(models.Model):
    """One outbound request. Never store credentials, prompts or generated content here."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="ai_usage")
    operation_key = models.CharField(max_length=100)
    operation_label = models.CharField(max_length=160)
    module = models.CharField(max_length=32)
    app_id = models.UUIDField(null=True)
    app_name = models.CharField(max_length=255, blank=True)
    workflow_id = models.UUIDField(null=True)
    provider = models.CharField(max_length=20)
    model = models.CharField(max_length=120)
    resolved_model = models.CharField(max_length=120, blank=True)
    status = models.CharField(max_length=16, default="pending")
    error_code = models.CharField(max_length=64, blank=True)
    input_tokens = models.PositiveBigIntegerField(null=True)
    output_tokens = models.PositiveBigIntegerField(null=True)
    cached_tokens = models.PositiveBigIntegerField(null=True)
    cache_write_tokens = models.PositiveBigIntegerField(null=True)
    reasoning_tokens = models.PositiveBigIntegerField(null=True)
    estimated_cost_usd = models.DecimalField(max_digits=18, decimal_places=8, null=True)
    reserved_cost_usd = models.DecimalField(max_digits=18, decimal_places=8, null=True)
    reserved_tokens = models.PositiveBigIntegerField(default=0)
    price = models.JSONField(default=dict)
    usage = models.JSONField(default=dict)
    historical = models.BooleanField(default=False)
    source_key = models.CharField(max_length=150, null=True, unique=True)
    created_at = models.DateTimeField()
    completed_at = models.DateTimeField(null=True)
    reconciled_by = models.ForeignKey(User, null=True, on_delete=models.SET_NULL)
    reconciled_at = models.DateTimeField(null=True)

    class Meta:
        indexes = [
            models.Index(fields=["workspace", "created_at"]),
            models.Index(fields=["workspace", "operation_key"]),
            models.Index(fields=["workflow_id"]),
        ]
