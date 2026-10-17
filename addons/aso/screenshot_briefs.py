"""Editable production briefs from retained visual findings. No generation or publishing."""

import copy
import io
import json
import re
import zipfile

from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from addons.app_catalog.models import MobileApp
from panda_store.core.access import workspace_access
from panda_store.core.models import Workspace

from .drafts import Conflict, operation
from .models import AuditRun, ScreenshotBrief, ScreenshotBriefRevision, ScreenshotEvidence
from .rules import localized_metadata

FIELDS = {
    "change": "Change to test",
    "screen": "Screen or state to capture",
    "caption": "Caption",
    "test_plan": "Test hypothesis",
}


class CreateRequest(serializers.Serializer):
    request_id = serializers.UUIDField()
    name = serializers.CharField(max_length=120)
    audit_id = serializers.UUIDField(required=False)
    image_id = serializers.CharField(max_length=30, required=False)
    duplicate_id = serializers.UUIDField(required=False)
    version = serializers.IntegerField(min_value=1, required=False)

    def validate(self, attrs):
        if ("audit_id" in attrs) == ("duplicate_id" in attrs):
            raise ValidationError("Choose an audit recommendation or an existing brief.")
        if "audit_id" in attrs and ("image_id" not in attrs or "version" in attrs):
            raise ValidationError("Choose a screenshot recommendation.")
        if "duplicate_id" in attrs and ("version" not in attrs or "image_id" in attrs):
            raise ValidationError("Include the saved version to duplicate.")
        return attrs


class EditRequest(serializers.Serializer):
    request_id = serializers.UUIDField()
    version = serializers.IntegerField(min_value=1)
    name = serializers.CharField(max_length=120, required=False)
    content = serializers.DictField(
        child=serializers.CharField(max_length=4000, allow_blank=True, trim_whitespace=False),
        required=False,
    )
    status = serializers.ChoiceField(choices=["draft", "ready"], required=False)
    claims_confirmed = serializers.BooleanField(required=False)
    restore_version = serializers.IntegerField(min_value=1, required=False)

    def validate(self, attrs):
        if set(attrs.get("content", {})) - set(FIELDS):
            raise ValidationError("Only supported brief fields can be edited.")
        editing = "name" in attrs or "content" in attrs
        if sum([editing, "status" in attrs, "restore_version" in attrs]) != 1:
            raise ValidationError("Edit, restore or change the brief status separately.")
        if "claims_confirmed" in attrs and attrs.get("status") != "ready":
            raise ValidationError("Confirm claims when marking a saved brief ready.")
        if attrs.get("status") == "ready" and not attrs.get("claims_confirmed"):
            raise ValidationError("Check the proposed claims against the app before marking ready.")
        return attrs


def summary(brief):
    return {
        "id": str(brief.pk),
        "name": brief.name,
        "locale": brief.locale,
        "version": brief.version,
        "status": brief.status,
        "created_at": brief.created_at,
        "updated_at": brief.updated_at,
    }


def serialize(brief):
    return {
        **summary(brief),
        "app_id": str(brief.app_id),
        "content": brief.content,
        "source": brief.source,
        "reference_url": f"/api/workspaces/{brief.workspace_id}/aso/images/{brief.reference_id}/"
        if brief.reference_id
        else None,
        "can_mark_ready": all(brief.content.get(key, "").strip() for key in ("change", "screen")),
    }


def revision(brief, user, values, reason):
    ScreenshotBriefRevision.objects.create(
        brief=brief,
        version=brief.version,
        name=brief.name,
        content=brief.content,
        status=brief.status,
        request_id=values["request_id"],
        operation=operation(values),
        author=user,
        reason=reason,
    )


def seed(app, values):
    if "duplicate_id" in values:
        original = get_object_or_404(
            ScreenshotBrief.objects.select_for_update(), app=app, pk=values["duplicate_id"]
        )
        if original.version != values["version"]:
            raise Conflict()
        return original.source, original.content, original.reference, original.locale
    run = get_object_or_404(AuditRun, app=app, pk=values["audit_id"])
    if run.workflow.status != "succeeded" or not (run.report or {}).get("visual"):
        raise ValidationError("Complete the screenshot review before creating a brief.")
    report = run.report["visual"]
    image = next(
        (item for item in report["images"] if item["image_id"] == values["image_id"]), None
    )
    if (
        not image
        or image["status"] != "reviewed"
        or image.get("verdict") != "improve"
        or not (isinstance(image.get("recommendation"), str) and image["recommendation"].strip())
    ):
        raise ValidationError("Only a retained screenshot recommendation can start a brief.")
    reference = get_object_or_404(
        ScreenshotEvidence,
        pk=image["asset_id"],
        audit__app=app,
        audit__workspace_id=app.workspace_id,
    )
    finding = copy.deepcopy(image)
    finding.pop("url", None)
    names = {item["image_id"]: item["name"] or item["image_id"] for item in report["images"]}
    for key in ("observation", "recommendation"):
        finding[key] = re.sub(
            r"\bshot-\d+\b", lambda match: names.get(match[0], match[0]), finding[key]
        )
    source = {
        "audit_id": str(run.pk),
        "snapshot_id": run.inputs["snapshot_id"],
        "imported_at": run.inputs["captured_at"],
        "audit_created_at": run.created_at.isoformat(),
        "review_version": report["version"],
        "model": report["resolved_model"],
        "finding": finding,
        "listing": localized_metadata(run.inputs["metadata"], run.locale),
    }
    content = {key: "" for key in FIELDS}
    content["change"] = finding["recommendation"]
    return source, content, reference, run.locale


@api_view(["GET", "POST"])
def briefs(request, workspace_id, app_id):
    workspace = workspace_access(
        request.user, workspace_id, write=request.method == "POST", module="aso"
    )
    app = get_object_or_404(MobileApp, workspace=workspace, pk=app_id)
    if request.method == "GET":
        return Response([summary(brief) for brief in app.screenshot_briefs.all()])
    data = CreateRequest(data=request.data)
    data.is_valid(raise_exception=True)
    values = data.validated_data
    with transaction.atomic():
        Workspace.objects.select_for_update().get(pk=workspace.pk)
        workspace_access(request.user, workspace_id, write=True, module="aso")
        brief = ScreenshotBrief.objects.filter(
            workspace=workspace, request_id=values["request_id"]
        ).first()
        created = brief is None
        if brief:
            if brief.app_id != app.pk or brief.create_request != operation(values):
                raise Conflict("This request ID has already been used.")
        else:
            source, content, reference, locale = seed(app, values)
            brief = ScreenshotBrief.objects.create(
                app=app,
                workspace=workspace,
                name=values["name"],
                locale=locale,
                source=source,
                content=content,
                reference=reference,
                request_id=values["request_id"],
                create_request=operation(values),
            )
            revision(
                brief,
                request.user,
                values,
                "Duplicated brief"
                if "duplicate_id" in values
                else "Added screenshot recommendation",
            )
    return Response(serialize(brief), status=201 if created else 200)


@api_view(["GET", "PATCH"])
def detail(request, workspace_id, brief_id):
    workspace = workspace_access(
        request.user, workspace_id, write=request.method == "PATCH", module="aso"
    )
    if request.method == "GET":
        return Response(
            serialize(get_object_or_404(ScreenshotBrief, workspace=workspace, pk=brief_id))
        )
    data = EditRequest(data=request.data)
    data.is_valid(raise_exception=True)
    values = data.validated_data
    with transaction.atomic():
        Workspace.objects.select_for_update().get(pk=workspace.pk)
        workspace_access(request.user, workspace_id, write=True, module="aso")
        brief = get_object_or_404(
            ScreenshotBrief.objects.select_for_update(), workspace=workspace, pk=brief_id
        )
        existing = brief.revisions.filter(request_id=values["request_id"]).first()
        if existing:
            if existing.operation != operation(values) or existing.version != brief.version:
                raise Conflict()
            return Response(serialize(brief))
        if values["version"] != brief.version:
            raise Conflict()
        reason = "Edited brief"
        if "restore_version" in values:
            old = get_object_or_404(brief.revisions, version=values["restore_version"])
            brief.name, brief.content, brief.status = old.name, old.content, "draft"
            reason = f"Restored revision {old.version}"
        elif "status" in values:
            if values["status"] == "ready" and not serialize(brief)["can_mark_ready"]:
                raise ValidationError(
                    "Describe the change and the screen to capture before marking ready."
                )
            brief.status = values["status"]
            reason = (
                "Claims reviewed; ready for design"
                if brief.status == "ready"
                else "Returned to draft"
            )
        else:
            before = (brief.name, copy.deepcopy(brief.content))
            brief.name = values.get("name", brief.name)
            brief.content = {**brief.content, **values.get("content", {})}
            if before != (brief.name, brief.content):
                brief.status = "draft"
        brief.version += 1
        brief.save()
        revision(brief, request.user, values, reason)
    return Response(serialize(brief))


@api_view(["GET"])
def history(request, workspace_id, brief_id):
    workspace = workspace_access(request.user, workspace_id, module="aso")
    brief = get_object_or_404(ScreenshotBrief, workspace=workspace, pk=brief_id)
    return Response(
        [
            {
                "version": item.version,
                "name": item.name,
                "content": item.content,
                "status": item.status,
                "reason": item.reason,
                "author": item.author.username if item.author else "Deleted account",
                "created_at": item.created_at,
            }
            for item in brief.revisions.select_related("author").all()
        ]
    )


@api_view(["GET"])
def export(request, workspace_id, brief_id):
    workspace = workspace_access(request.user, workspace_id, module="aso")
    brief = get_object_or_404(
        ScreenshotBrief.objects.select_related("app", "reference"), workspace=workspace, pk=brief_id
    )
    try:
        version = int(request.query_params.get("version", brief.version))
    except (ValueError, TypeError) as exc:
        raise ValidationError("Choose a saved revision.") from exc
    saved = get_object_or_404(brief.revisions, version=version)
    finding = brief.source["finding"]
    data = {
        "name": saved.name,
        "app": brief.app.name,
        "locale": brief.locale,
        "version": version,
        "status": saved.status,
        "content": saved.content,
        "source": brief.source,
        "reference_file": "reference.jpg" if brief.reference_id else None,
    }
    lines = [
        f"# {saved.name}",
        "",
        f"{brief.app.name} · {brief.locale} · Revision {version}",
        f"Status: {saved.status}. This is a design brief, not a published screenshot.",
        "",
    ]
    for field, label in FIELDS.items():
        lines.extend([f"## {label}", "", saved.content.get(field) or "Not specified.", ""])
    lines.extend(
        [
            "## Reference",
            "",
            finding["name"],
            finding["observation"],
            "",
            "reference.jpg is the archived model input, not the original upload."
            if brief.reference_id
            else "The reference image is no longer available.",
            "Import order does not establish live storefront order. No performance gains measured.",
            "",
        ]
    )
    for source in finding.get("sources", []):
        lines.extend(
            [
                f"- {source['publisher']}: {source['title']} ({source['url']})",
                f"  Reviewed: {source.get('reviewed_on', 'Unknown')}",
                f"  {source.get('limitations', '')}",
            ]
        )
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
        bundle.writestr("brief.md", "\n".join(lines))
        bundle.writestr("brief.json", json.dumps(data, ensure_ascii=False, indent=2))
        if brief.reference_id:
            bundle.writestr("reference.jpg", bytes(brief.reference.data))
    response = HttpResponse(archive.getvalue(), content_type="application/zip")
    response["Content-Disposition"] = (
        f'attachment; filename="panda-screenshot-brief-{brief.pk}-v{version}.zip"'
    )
    response["Cache-Control"] = "private, no-store"
    return response
