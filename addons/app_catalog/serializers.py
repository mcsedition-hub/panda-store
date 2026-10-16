from rest_framework import serializers

from .models import MetadataSnapshot, MobileApp


class SnapshotSerializer(serializers.ModelSerializer):
    class Meta:
        model = MetadataSnapshot
        fields = ["id", "data", "source", "captured_at"]


class AppSerializer(serializers.ModelSerializer):
    metadata = serializers.SerializerMethodField()

    def get_metadata(self, obj):
        snapshots = list(obj.snapshots.all())
        return SnapshotSerializer(snapshots[0]).data if snapshots else None

    class Meta:
        model = MobileApp
        fields = [
            "id",
            "name",
            "platform",
            "bundle_id",
            "external_id",
            "is_demo",
            "metadata",
            "sync_provider",
            "last_synced_at",
            "last_sync_error",
        ]
