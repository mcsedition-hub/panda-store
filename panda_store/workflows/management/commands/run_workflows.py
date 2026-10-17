import time

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from panda_store.workflows.worker import tick


class Command(BaseCommand):
    help = "Run queued workflows locally without a Redis service."

    def add_arguments(self, parser):
        parser.add_argument(
            "--once", action="store_true", help="Process one queued workflow and exit."
        )

    def handle(self, *args, **options):
        if settings.PANDA_WORKFLOW_DISPATCH != "database":
            raise CommandError("Use a Celery worker when PANDA_WORKFLOW_DISPATCH=celery.")
        self.stdout.write("Panda workflow worker ready. Stop with Ctrl+C.")
        try:
            while True:
                worked = tick()
                if options["once"]:
                    return
                if not worked:
                    time.sleep(1)
        except KeyboardInterrupt:
            self.stdout.write("Worker stopped.")
