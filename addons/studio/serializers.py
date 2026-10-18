from rest_framework import serializers

from .models import Brief, Creative, GenerationRun


class BriefSerializer(serializers.ModelSerializer):
    research = serializers.UUIDField(allow_null=True, required=False)
    research_page_ids = serializers.ListField(
        child=serializers.UUIDField(), max_length=3, required=False
    )
    product_facts = serializers.CharField(max_length=4000, allow_blank=True, required=False)
    duration_seconds = serializers.ChoiceField(choices=[15, 30, 45, 60], required=False)
    research_sources = serializers.SerializerMethodField()

    def get_research_sources(self, obj):
        if not obj.research_id:
            return []
        from .creative_context import selected_sources

        try:
            return selected_sources(obj.app, obj.research_id, obj.research_page_ids)[1]
        except serializers.ValidationError:
            return []

    def to_representation(self, instance):
        # The input is a UUID, while the model field holds a relation.
        result = super().to_representation(instance)
        result["research"] = str(instance.research_id) if instance.research_id else None
        return result

    def validate(self, attrs):
        research_id = attrs.pop("research", self.instance.research_id if self.instance else None)
        page_ids = [
            str(p)
            for p in attrs.get(
                "research_page_ids", self.instance.research_page_ids if self.instance else []
            )
        ]
        if research_id or page_ids:
            from .creative_context import selected_sources

            app = self.context.get("app") or self.instance.app
            selected_sources(app, research_id, page_ids)
        attrs["research_id"] = research_id
        attrs["research_page_ids"] = page_ids
        return attrs

    class Meta:
        model = Brief
        fields = [
            "audience",
            "goal",
            "tone",
            "updated_at",
            "research",
            "research_page_ids",
            "research_sources",
            "product_facts",
            "language",
            "duration_seconds",
        ]
        read_only_fields = ["updated_at"]


class CreativeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Creative
        fields = [
            "id",
            "variant",
            "angle",
            "hook",
            "script",
            "cta",
            "approved",
            "updated_at",
            "provenance",
        ]
        read_only_fields = ["id", "variant", "angle", "updated_at", "provenance"]


class RunSerializer(serializers.ModelSerializer):
    creatives = CreativeSerializer(many=True, read_only=True)
    status = serializers.SerializerMethodField()
    error = serializers.SerializerMethodField()
    completed_at = serializers.SerializerMethodField()
    workflow_id = serializers.UUIDField(read_only=True, allow_null=True)
    context = serializers.SerializerMethodField()

    def get_context(self, obj):
        if obj.provider == "demo_templates":
            return None
        return {
            "mode": obj.inputs.get("mode", "legacy"),
            "snapshot_id": obj.inputs["snapshot_id"],
            "brief": obj.inputs["brief"],
            "research_id": obj.inputs["research_id"],
            "sources": obj.inputs["sources"],
            "ai": {k: obj.inputs["ai"][k] for k in ("provider", "model")},
            "facts_confirmed_at": obj.inputs["facts_confirmed_at"],
        }

    def get_status(self, obj):
        return obj.workflow.status if obj.workflow_id else obj.status

    def get_error(self, obj):
        return obj.workflow.error if obj.workflow_id else obj.error

    def get_completed_at(self, obj):
        return obj.workflow.completed_at if obj.workflow_id else obj.completed_at

    class Meta:
        model = GenerationRun
        fields = [
            "id",
            "status",
            "provider",
            "error",
            "created_at",
            "completed_at",
            "creatives",
            "workflow_id",
            "context",
            "review",
        ]


class GenerateRequest(serializers.Serializer):
    request_id = serializers.UUIDField()
