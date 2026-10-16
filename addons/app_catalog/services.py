import hashlib
import json

from django.db import transaction

from .models import MetadataSnapshot, MobileApp


@transaction.atomic
def import_app(workspace, *, metadata, source, is_demo):
    app, created = MobileApp.objects.update_or_create(
        workspace=workspace,
        platform=metadata["platform"],
        external_id=metadata["external_id"],
        defaults={"name": metadata["name"], "bundle_id": metadata["bundle_id"], "is_demo": is_demo},
    )
    digest = hashlib.sha256(json.dumps(metadata, sort_keys=True).encode()).hexdigest()
    latest = app.snapshots.first()
    if latest is None or latest.fingerprint != digest or latest.source != source:
        MetadataSnapshot.objects.create(app=app, fingerprint=digest, source=source, data=metadata)
    return app, created
