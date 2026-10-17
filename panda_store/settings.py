import os
from pathlib import Path

import dj_database_url
from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def env_bool(name, default=False):
    return os.getenv(name, str(default)).lower() in {"true", "1", "yes"}


SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    raise ImproperlyConfigured("Run python3 scripts/bootstrap.py to create your local .env.")
DEBUG = env_bool("DJANGO_DEBUG")
ALLOWED_HOSTS = os.getenv("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")
CSRF_TRUSTED_ORIGINS = list(filter(None, os.getenv("DJANGO_CSRF_TRUSTED_ORIGINS", "").split(",")))

# Trusted Python packages are installed at deployment, not uploaded by workspace users.
PANDA_MODULE_PACKAGES = tuple(
    filter(
        None,
        os.getenv(
            "PANDA_MODULE_PACKAGES",
            "addons.app_catalog,addons.apple_store,addons.aso,addons.studio,addons.example",
        ).split(","),
    )
)
PANDA_CORE_VERSION = "0.1.0"
PANDA_CREDENTIAL_KEYS = tuple(
    key.strip() for key in os.getenv("PANDA_CREDENTIAL_KEYS", "").split(",") if key.strip()
)
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "panda_store.core",
    "panda_store.workflows",
    *PANDA_MODULE_PACKAGES,
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
ROOT_URLCONF = "panda_store.urls"
WSGI_APPLICATION = "panda_store.wsgi.application"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]
DATABASES = {
    "default": dj_database_url.config(
        default=f"sqlite:///{BASE_DIR / 'panda.sqlite3'}",
        # ASGI requests must not retain thread-bound persistent connections.
        conn_max_age=0,
    )
}
AUTH_USER_MODEL = "core.User"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "EXCEPTION_HANDLER": "panda_store.core.errors.exception_handler",
}
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = env_bool("DJANGO_SECURE_COOKIES", not DEBUG)
CSRF_COOKIE_SECURE = SESSION_COOKIE_SECURE
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
DATA_UPLOAD_MAX_MEMORY_SIZE = 1_048_576

PANDA_DEMO_MODE = env_bool("PANDA_DEMO_MODE")
PANDA_WORKFLOW_DISPATCH = os.getenv("PANDA_WORKFLOW_DISPATCH", "database")
if PANDA_WORKFLOW_DISPATCH not in {"database", "celery"}:
    raise ImproperlyConfigured("PANDA_WORKFLOW_DISPATCH must be database or celery.")
PANDA_SETUP_ENABLED = env_bool("PANDA_SETUP_ENABLED")
PANDA_DEMO_USERNAME = os.getenv("PANDA_DEMO_USERNAME", "demo")
CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
CELERY_TASK_ALWAYS_EAGER = env_bool("CELERY_TASK_ALWAYS_EAGER")
CELERY_TASK_EAGER_PROPAGATES = False
CELERY_TASK_IGNORE_RESULT = True
CELERY_TASK_SERIALIZER = "json"
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SOFT_TIME_LIMIT = 60
CELERY_TASK_TIME_LIMIT = 90
CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = True
