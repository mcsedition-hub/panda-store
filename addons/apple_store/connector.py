"""The demo connector exercises the real import pipeline without external credentials."""

import json
from importlib.resources import files

from django.conf import settings
from rest_framework.exceptions import NotFound, PermissionDenied


class DemoAppleConnector:
    def list_apps(self):
        if not settings.PANDA_DEMO_MODE:
            raise PermissionDenied("Le mode démonstration est désactivé.")
        return json.loads(files("addons.apple_store").joinpath("fixtures/apps.json").read_text())

    def get_metadata(self, external_id):
        for metadata in self.list_apps():
            if metadata["external_id"] == external_id:
                return metadata
        raise NotFound("Application de démonstration introuvable.")
