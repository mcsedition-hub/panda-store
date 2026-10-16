from django.apps import AppConfig


class CoreConfig(AppConfig):
    name = "panda_store.core"

    def ready(self):
        from .registry import get_registry

        get_registry()
