"""Local listing drafts. Nothing in this module writes to a store."""

import copy

from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.response import Response

from addons.app_catalog.models import MobileApp
from panda_store.core.access import workspace_access
from panda_store.core.models import Workspace

from .models import AuditRun, DraftRevision, ListingDraft
from .rules import FIELDS, RULESET, audit, localized_metadata

LABELS = {
    "name": "App name",
    "subtitle": "Subtitle",
    "description": "Description",
    "keywords": "Keywords",
    "promotional_text": "Promotional text",
}


class Conflict(APIException):
    status_code = 409
    default_detail = (
        "This draft changed in another session. Your text is kept here. "
        "Reload the saved version to compare."
    )


class CreateRequest(serializers.Serializer):
    request_id = serializers.UUIDField()
    name = serializers.CharField(max_length=120)
    locale = serializers.CharField(max_length=35, required=False)
    snapshot_id = serializers.UUIDField(required=False)
    audit_id = serializers.UUIDField(required=False)
    check_id = serializers.CharField(max_length=100, required=False)
    duplicate_id = serializers.UUIDField(required=False)
    version = serializers.IntegerField(min_value=1, required=False)

    def validate(self, attrs):
        if sum(key in attrs for key in ("snapshot_id", "audit_id", "duplicate_id")) != 1:
            raise ValidationError(
                "Choose one imported listing, audit finding or draft to start from."
            )
        if "snapshot_id" in attrs and not attrs.get("locale"):
            raise ValidationError("Choose a language.")
        if "audit_id" in attrs and not attrs.get("check_id"):
            raise ValidationError("Choose the finding to add.")
        if "duplicate_id" in attrs and "version" not in attrs:
            raise ValidationError("Include the draft version to duplicate.")
        return attrs


class EditRequest(serializers.Serializer):
    request_id = serializers.UUIDField()
    version = serializers.IntegerField(min_value=1)
    name = serializers.CharField(max_length=120, required=False)
    content = serializers.DictField(
        child=serializers.CharField(max_length=20000, allow_blank=True, trim_whitespace=False),
        required=False,
    )
    status = serializers.ChoiceField(choices=["draft", "ready"], required=False)
    restore_version = serializers.IntegerField(min_value=1, required=False)

    def validate(self, attrs):
        if set(attrs.get("content", {})) - set(FIELDS):
            raise ValidationError("Only supported listing fields can be edited.")
        if "restore_version" in attrs and any(
            key in attrs for key in ("name", "content", "status")
        ):
            raise ValidationError("Restore a revision separately from other changes.")
        if attrs.get("status") == "ready" and any(key in attrs for key in ("name", "content")):
            raise ValidationError("Save changes before marking the draft ready.")
        return attrs


def operation(values):
    return {key: str(value) if key.endswith("_id") else value for key, value in values.items()}


def revision(draft, user, values, reason):
    DraftRevision.objects.create(
        draft=draft,
        version=draft.version,
        name=draft.name,
        content=draft.content,
        status=draft.status,
        request_id=values["request_id"],
        operation=operation(values),
        reason=reason,
        author=user,
    )


def validation(draft):
    # Reuse the same sourced rules on precisely the proposed localization.
    data = {
        **draft.inputs,
        "ruleset": RULESET,
        "metadata": {"locale": draft.locale, **draft.content},
    }
    checks = [check for check in audit(data)["checks"] if check["field"] in FIELDS]
    blocking = [
        check
        for check in checks
        if check["status"] == "issue"
        or (check["id"] == "keywords.length" and check["status"] == "review")
        or (
            check["field"] in {"name", "description", "keywords"}
            and check["status"] == "unavailable"
        )
    ]
    return {
        "checks": checks,
        "can_mark_ready": not blocking,
        "blocking": [check["id"] for check in blocking],
        "ruleset": RULESET,
    }


def summary(draft):
    return {
        "id": str(draft.pk),
        "name": draft.name,
        "locale": draft.locale,
        "status": draft.status,
        "version": draft.version,
        "updated_at": draft.updated_at,
        "created_at": draft.created_at,
    }


def serialize(draft):
    baseline = localized_metadata(draft.inputs["metadata"], draft.locale)
    changed = [field for field in FIELDS if draft.content.get(field) != baseline.get(field)]
    latest = draft.app.snapshots.first()
    latest_content = None
    if latest:
        try:
            latest_content = localized_metadata(latest.data, draft.locale)
        except ValueError:
            pass
    matching = [
        field
        for field in changed
        if latest_content is not None
        and field in latest_content
        and latest_content[field] == draft.content[field]
    ]
    drift = [
        field
        for field in FIELDS
        if latest_content is not None and latest_content.get(field) != baseline.get(field)
    ]
    return {
        **summary(draft),
        "app_id": str(draft.app_id),
        "content": draft.content,
        "baseline": baseline,
        "snapshot_id": draft.inputs["snapshot_id"],
        "captured_at": draft.inputs["captured_at"],
        "is_demo": draft.inputs["is_demo"],
        "provenance": draft.provenance,
        "changed_fields": changed,
        "validation": validation(draft),
        "latest": {
            "snapshot_id": str(latest.pk) if latest else None,
            "captured_at": latest.captured_at if latest else None,
            "content": latest_content,
            "changed_since_baseline": drift,
            "matching_fields": matching,
            "all_changes_match": bool(changed) and len(matching) == len(changed),
        },
    }


def seed(app, values):
    provenance = []
    if "duplicate_id" in values:
        original = get_object_or_404(
            ListingDraft.objects.select_for_update(), app=app, pk=values["duplicate_id"]
        )
        if original.version != values["version"]:
            raise Conflict()
        return original.inputs, original.content, original.provenance, "Duplicated draft"
    if "audit_id" in values:
        run = get_object_or_404(AuditRun, pk=values["audit_id"], app=app)
        if not run.report or run.workflow.status != "succeeded":
            raise ValidationError("Complete the audit before creating a draft from it.")
        check = next(
            (check for check in run.report["checks"] if check["id"] == values["check_id"]), None
        )
        if (
            not check
            or check["field"] not in FIELDS
            or not isinstance(check.get("replacement"), str)
        ):
            raise ValidationError("This finding has no editable proposal.")
        inputs = run.inputs
        provenance = [{"audit_id": str(run.pk), "check": check}]
    else:
        if app.platform != "ios":
            raise ValidationError("Drafts currently support App Store listings only.")
        snapshot = get_object_or_404(app.snapshots, pk=values["snapshot_id"])
        inputs = {
            "metadata": snapshot.data,
            "snapshot_id": str(snapshot.pk),
            "captured_at": snapshot.captured_at.isoformat(),
            "locale": values["locale"],
            "source": snapshot.source,
            "platform": app.platform,
            "is_demo": app.is_demo,
        }
    try:
        content = localized_metadata(inputs["metadata"], inputs["locale"])
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc
    if provenance:
        content[check["field"]] = check["replacement"]
    return (
        inputs,
        content,
        provenance,
        "Added audit proposal" if provenance else "Created from imported listing",
    )


@api_view(["GET", "POST"])
def drafts(request, workspace_id, app_id):
    workspace = workspace_access(
        request.user, workspace_id, write=request.method == "POST", module="aso"
    )
    app = get_object_or_404(MobileApp, workspace=workspace, pk=app_id)
    if request.method == "GET":
        return Response([summary(draft) for draft in app.aso_drafts.all()])
    data = CreateRequest(data=request.data)
    data.is_valid(raise_exception=True)
    values = data.validated_data
    with transaction.atomic():
        Workspace.objects.select_for_update().get(pk=workspace.pk)
        workspace_access(request.user, workspace_id, write=True, module="aso")
        draft = ListingDraft.objects.filter(
            workspace=workspace, request_id=values["request_id"]
        ).first()
        created = draft is None
        if draft:
            if draft.app_id != app.pk or draft.create_request != operation(values):
                raise Conflict("This request ID has already been used.")
        else:
            inputs, content, provenance, reason = seed(app, values)
            draft = ListingDraft.objects.create(
                workspace=workspace,
                app=app,
                name=values["name"],
                locale=inputs["locale"],
                inputs=inputs,
                content=content,
                provenance=provenance,
                request_id=values["request_id"],
                create_request=operation(values),
            )
            revision(draft, request.user, values, reason)
    return Response(serialize(draft), status=201 if created else 200)


@api_view(["GET", "PATCH"])
def detail(request, workspace_id, draft_id):
    workspace = workspace_access(
        request.user, workspace_id, write=request.method == "PATCH", module="aso"
    )
    if request.method == "GET":
        draft = get_object_or_404(
            ListingDraft.objects.select_related("app"), workspace=workspace, pk=draft_id
        )
        return Response(serialize(draft))
    data = EditRequest(data=request.data)
    data.is_valid(raise_exception=True)
    values = data.validated_data
    with transaction.atomic():
        Workspace.objects.select_for_update().get(pk=workspace.pk)
        workspace_access(request.user, workspace_id, write=True, module="aso")
        draft = get_object_or_404(
            ListingDraft.objects.select_for_update(), workspace=workspace, pk=draft_id
        )
        existing = draft.revisions.filter(request_id=values["request_id"]).first()
        if existing:
            if existing.operation != operation(values) or existing.version != draft.version:
                raise Conflict()
            return Response(serialize(draft))
        if values["version"] != draft.version:
            raise Conflict()
        before = (draft.name, copy.deepcopy(draft.content), draft.status)
        reason = "Edited draft"
        if "restore_version" in values:
            old = get_object_or_404(draft.revisions, version=values["restore_version"])
            draft.name, draft.content, draft.status = old.name, old.content, "draft"
            reason = f"Restored revision {old.version}"
        elif "name" in values or "content" in values:
            draft.name = values.get("name", draft.name)
            draft.content = {**draft.content, **values.get("content", {})}
            if before[:2] != (draft.name, draft.content):
                draft.status = "draft"
        elif "status" in values:
            if values["status"] == "ready":
                if not validation(draft)["can_mark_ready"]:
                    raise ValidationError(
                        "Resolve missing required fields and field limits before marking ready."
                    )
                reason = "Marked ready for manual application"
            else:
                reason = "Returned to draft"
            draft.status = values["status"]
        # Record even a no-op mutation for safe retries after a lost response.
        draft.version += 1
        draft.save()
        revision(draft, request.user, values, reason)
    return Response(serialize(draft))


@api_view(["GET"])
def history(request, workspace_id, draft_id):
    workspace = workspace_access(request.user, workspace_id, module="aso")
    draft = get_object_or_404(ListingDraft, workspace=workspace, pk=draft_id)
    return Response(
        [
            {
                "version": item.version,
                "name": item.name,
                "content": item.content,
                "status": item.status,
                "reason": item.reason,
                "created_at": item.created_at,
                "author": item.author.username if item.author else "Deleted account",
            }
            for item in draft.revisions.select_related("author").all()
        ]
    )


@api_view(["GET"])
def export(request, workspace_id, draft_id):
    workspace = workspace_access(request.user, workspace_id, module="aso")
    draft = get_object_or_404(ListingDraft, workspace=workspace, pk=draft_id)
    # Export a pinned saved revision, so an intervening edit cannot change the download.
    try:
        version = int(request.query_params.get("version", draft.version))
    except (TypeError, ValueError) as exc:
        raise ValidationError("Choose a saved revision.") from exc
    saved = get_object_or_404(draft.revisions, version=version)
    baseline = localized_metadata(draft.inputs["metadata"], draft.locale)
    lines = [
        saved.name,
        f"App Store · {draft.locale} · Revision {version}",
        f"Status: {saved.status}. Not submitted to Apple.",
        f"Reference imported: {draft.inputs['captured_at']}",
        "",
    ]
    for field in FIELDS:
        if field in saved.content and saved.content[field] != baseline.get(field):
            lines += [LABELS[field], saved.content[field], ""]
    response = HttpResponse("\n".join(lines), content_type="text/plain; charset=utf-8")
    response["Content-Disposition"] = (
        f'attachment; filename="panda-draft-{draft.pk}-v{version}.txt"'
    )
    response["Cache-Control"] = "no-store"
    return response
