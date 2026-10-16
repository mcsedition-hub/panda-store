import os

os.environ["DJANGO_SECRET_KEY"] = "test-only-key-not-for-deployment-000000000000000000000000"
os.environ["DJANGO_DEBUG"] = "false"
os.environ["DJANGO_SECURE_COOKIES"] = "false"
os.environ["PANDA_DEMO_MODE"] = "true"
os.environ["PANDA_SETUP_ENABLED"] = "false"
os.environ["CELERY_TASK_ALWAYS_EAGER"] = "true"
# CI may supply a disposable PostgreSQL database; local tests use an in-memory DB.
os.environ["DATABASE_URL"] = os.getenv("TEST_DATABASE_URL", "sqlite:///:memory:")

from .settings import *  # noqa: E402,F403

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
