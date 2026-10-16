"""First-run setup for a local installation; never resets an existing account database."""

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.validators import UnicodeUsernameValidator
from django.core.exceptions import ValidationError
from django.db import transaction
from rest_framework import serializers

from .access import activate_modules
from .management.commands.seed_demo import DEMO_WORKSPACE_ID
from .models import Installation, Membership, User, Workspace


def seeded_membership():
    # Upgrade only the single, non-admin demo account from the earlier alpha.
    # Any real multi-user installation keeps its existing sign-in flow.
    if not settings.PANDA_DEMO_MODE:
        return None
    if (
        User.objects.count() != 1
        or Workspace.objects.count() != 1
        or Membership.objects.count() != 1
    ):
        return None
    return (
        Membership.objects.select_related("user", "workspace")
        .filter(
            workspace_id=DEMO_WORKSPACE_ID,
            user__username=settings.PANDA_DEMO_USERNAME,
            user__is_active=True,
            user__is_staff=False,
            user__is_superuser=False,
            role=Membership.Role.OWNER,
        )
        .first()
    )


def setup_available():
    if not settings.PANDA_SETUP_ENABLED or Installation.objects.exists():
        return False
    if not User.objects.exists() and not Workspace.objects.exists():
        return True
    return seeded_membership() is not None


class SetupSerializer(serializers.Serializer):
    organization_name = serializers.CharField(max_length=100)
    username = serializers.CharField(max_length=150, validators=[UnicodeUsernameValidator()])
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(max_length=1024, trim_whitespace=False, write_only=True)
    password_confirmation = serializers.CharField(
        max_length=1024, trim_whitespace=False, write_only=True
    )

    def validate(self, data):
        if data["password"] != data["password_confirmation"]:
            raise serializers.ValidationError({"password_confirmation": "Passwords do not match."})
        candidate = User(username=data["username"], email=data["email"])
        try:
            validate_password(data["password"], user=candidate)
        except ValidationError as exc:
            raise serializers.ValidationError({"password": exc.messages}) from exc
        return data


@transaction.atomic
def configure_installation(data):
    # The first write reserves the singleton. A competing setup cannot commit;
    # every write here (including the reservation) rolls back on failure.
    installation = Installation.objects.create(pk=1)
    membership = seeded_membership()
    if User.objects.exists() or Workspace.objects.exists():
        if membership is None:
            raise ValidationError("This installation already has accounts. Sign in to continue.")
        user, workspace = membership.user, membership.workspace
        user.username = data["username"]
        user.email = data["email"]
        workspace.name = data["organization_name"]
        workspace.save(update_fields=["name"])
    else:
        user = User(username=data["username"], email=data["email"])
        workspace = Workspace.objects.create(name=data["organization_name"])
    user.set_password(data["password"])
    user.save()
    Membership.objects.get_or_create(
        user=user, workspace=workspace, defaults={"role": Membership.Role.OWNER}
    )
    activate_modules(workspace, ["app_catalog", "apple_store", "studio"])
    installation.owner = user
    installation.workspace = workspace
    installation.save(update_fields=["owner", "workspace"])
    return user
