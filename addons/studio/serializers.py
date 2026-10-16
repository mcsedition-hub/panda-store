from rest_framework import serializers

from .models import Brief, Creative, GenerationRun


class BriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Brief
        fields = ["audience", "goal", "tone", "updated_at"]
        read_only_fields = ["updated_at"]


class CreativeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Creative
        fields = ["id", "variant", "angle", "hook", "script", "cta", "approved", "updated_at"]
        read_only_fields = ["id", "variant", "angle", "updated_at"]


class RunSerializer(serializers.ModelSerializer):
    creatives = CreativeSerializer(many=True, read_only=True)

    class Meta:
        model = GenerationRun
        fields = ["id", "status", "provider", "error", "created_at", "completed_at", "creatives"]


class GenerateRequest(serializers.Serializer):
    request_id = serializers.UUIDField()
