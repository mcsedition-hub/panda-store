import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "panda_store.settings")
app = Celery("panda_store")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
