import os
import uuid

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from panda_store.core.access import activate_modules
from panda_store.core.models import Membership, User, Workspace

DEMO_WORKSPACE_ID = uuid.UUID("8883d058-1f9b-472c-86d9-b3777dc29c13")


class Command(BaseCommand):
    help = "Create the local demo workspace without resetting existing passwords or data."

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.PANDA_DEMO_MODE:
            raise CommandError("Enable PANDA_DEMO_MODE explicitly before seeding demo data.")
        password = os.getenv("PANDA_DEMO_PASSWORD", "")
        username = os.getenv("PANDA_DEMO_USERNAME", "demo")
        if len(password) < 16:
            raise CommandError("Set a random PANDA_DEMO_PASSWORD of at least 16 characters.")
        user, created = User.objects.get_or_create(username=username)
        if created:
            user.set_password(password)
            user.save(update_fields=["password"])
        workspace, _ = Workspace.objects.get_or_create(
            pk=DEMO_WORKSPACE_ID,
            defaults={"name": "Mon atelier"},
        )
        Membership.objects.get_or_create(
            user=user,
            workspace=workspace,
            defaults={"role": Membership.Role.OWNER},
        )
        activate_modules(workspace, ["app_catalog", "apple_store", "studio"])
        self.stdout.write("Demo workspace ready. Existing passwords and apps preserved.")
