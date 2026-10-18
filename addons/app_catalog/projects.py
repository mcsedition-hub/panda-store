"""User-authored projects, independent of store accounts and immutable store imports."""

import hashlib
import json

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from panda_store.core.access import workspace_access
from panda_store.core.models import Workspace

from .models import MetadataSnapshot, MobileApp
from .serializers import AppSerializer


class DraftListing(serializers.Serializer):
    name = serializers.CharField(max_length=200, allow_blank=True, default="")
    subtitle = serializers.CharField(max_length=200, allow_blank=True, default="")
    description = serializers.CharField(max_length=8000, allow_blank=True, default="")
    keywords = serializers.CharField(max_length=500, allow_blank=True, default="")
    promotional_text = serializers.CharField(max_length=500, allow_blank=True, default="")


class ProjectDetails(serializers.Serializer):
    name = serializers.CharField(max_length=200)
    platform = serializers.ChoiceField(choices=["ios", "android", "undecided"])
    stage = serializers.ChoiceField(choices=["idea", "development"])
    locale = serializers.RegexField(r"^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$", max_length=35)
    specification = serializers.CharField(min_length=20, max_length=20000)
    audience = serializers.CharField(max_length=500, allow_blank=True, default="")
    available_features = serializers.CharField(max_length=4000, allow_blank=True, default="")
    listing = DraftListing(required=False)

    def validate(self, data):
        if "\x00" in data["specification"]:
            raise ValidationError("The project description must be plain text or Markdown.")
        if data["stage"] == "idea" and data["available_features"]:
            raise ValidationError(
                "An idea cannot have implemented features. Choose In development."
            )
        return data


class CreateProject(ProjectDetails):
    request_id = serializers.UUIDField()


class UpdateProject(ProjectDetails):
    snapshot_id = serializers.UUIDField()


def metadata(values, previous=None):
    # Preserve texts saved by earlier clients when editing just the project description.
    listing = {
        key: values.get("listing", previous or {}).get(key, "") for key in DraftListing().fields
    }
    listing["name"] = listing["name"] or values["name"]
    return {
        **listing,
        "locale": values["locale"],
        "platform": values["platform"],
        "category": "",
        "project": {
            "origin": "project",
            "name": values["name"],
            "stage": values["stage"],
            "specification": values["specification"],
            "audience": values["audience"],
            "available_features": values["available_features"],
            "listing_ready": bool(any(listing[key] for key in listing if key != "name")),
        },
    }


def fingerprint(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def serialize(app):
    fresh = MobileApp.objects.prefetch_related("snapshots").get(pk=app.pk)
    return AppSerializer(fresh).data


@api_view(["POST"])
def create(request, workspace_id):
    workspace = workspace_access(request.user, workspace_id, write=True, module="app_catalog")
    payload = CreateProject(data=request.data)
    payload.is_valid(raise_exception=True)
    values = payload.validated_data
    data = metadata(values)
    digest = fingerprint(data)
    external_id = f"project:{values['request_id']}"
    with transaction.atomic():
        Workspace.objects.select_for_update().get(pk=workspace.pk)
        workspace_access(request.user, workspace_id, write=True, module="app_catalog")
        app = MobileApp.objects.filter(
            workspace=workspace, origin="project", external_id=external_id
        ).first()
        if app:
            original = app.snapshots.order_by("captured_at", "pk").first()
            if not original or original.fingerprint != digest:
                return Response({"error": "This request ID has already been used."}, status=409)
            return Response(serialize(app))
        app = MobileApp.objects.create(
            workspace=workspace,
            name=values["name"],
            platform=values["platform"],
            origin="project",
            external_id=external_id,
        )
        MetadataSnapshot.objects.create(
            app=app, data=data, fingerprint=digest, source="project.manual"
        )
    return Response(serialize(app), status=201)


@api_view(["PUT"])
def update(request, workspace_id, app_id):
    workspace = workspace_access(request.user, workspace_id, write=True, module="app_catalog")
    payload = UpdateProject(data=request.data)
    payload.is_valid(raise_exception=True)
    values = payload.validated_data
    with transaction.atomic():
        Workspace.objects.select_for_update().get(pk=workspace.pk)
        workspace_access(request.user, workspace_id, write=True, module="app_catalog")
        app = get_object_or_404(MobileApp, workspace=workspace, pk=app_id, origin="project")
        latest = app.snapshots.first()
        data = metadata(values, latest.data if latest else None)
        digest = fingerprint(data)
        if latest and latest.fingerprint == digest:
            return Response(serialize(app))
        if latest is None or latest.pk != values["snapshot_id"]:
            return Response(
                {"error": "This project changed. Reopen it before saving your edits."}, status=409
            )
        app.name, app.platform = values["name"], values["platform"]
        app.save(update_fields=["name", "platform", "updated_at"])
        MetadataSnapshot.objects.create(
            app=app, data=data, fingerprint=digest, source="project.manual"
        )
    return Response(serialize(app))
