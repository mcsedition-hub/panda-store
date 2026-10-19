"""Local listing drafts. Nothing in this module writes to a store."""

import copy
import json

from django.core.serializers.json import DjangoJSONEncoder
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
from .rules import audit, localized_metadata, ruleset_for
from .stores import ALL_FIELDS, fields_for, publisher, store_name

LABELS = {
    "name": "App name",
    "subtitle": "Subtitle",
    "description": "Description",
    "keywords": "Keywords",
    "promotional_text": "Promotional text",
    "short_description": "Short description",
}


class Conflict(APIException):
    status_code = 409
    default_detail = (
        "This draft changed in another session. Your text is kept here. "
        "Reload the saved version to compare."
    )


class ComparisonSelection(serializers.Serializer):
    field = serializers.ChoiceField(choices=ALL_FIELDS)
    audit_id = serializers.UUIDField()
    check_id = serializers.CharField(max_length=100)


class ComparisonRequest(serializers.Serializer):
    base_audit_id = serializers.UUIDField()
    selections = ComparisonSelection(many=True, allow_empty=False, max_length=5)

    def validate_selections(self, items):
        if len({item["field"] for item in items}) != len(items):
            raise ValidationError("Choose only one proposal per listing field.")
        return items


class CreateRequest(serializers.Serializer):
    request_id = serializers.UUIDField()
    name = serializers.CharField(max_length=120)
    locale = serializers.CharField(max_length=35, required=False)
    snapshot_id = serializers.UUIDField(required=False)
    audit_id = serializers.UUIDField(required=False)
    check_id = serializers.CharField(max_length=100, required=False)
    duplicate_id = serializers.UUIDField(required=False)
    version = serializers.IntegerField(min_value=1, required=False)
    comparison = ComparisonRequest(required=False)

    def validate(self, attrs):
        if (
            sum(key in attrs for key in ("snapshot_id", "audit_id", "duplicate_id", "comparison"))
            != 1
        ):
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
        if set(attrs.get("content", {})) - set(ALL_FIELDS):
            raise ValidationError("Only supported listing fields can be edited.")
        if "restore_version" in attrs and any(
            key in attrs for key in ("name", "content", "status")
        ):
            raise ValidationError("Restore a revision separately from other changes.")
        if attrs.get("status") == "ready" and any(key in attrs for key in ("name", "content")):
            raise ValidationError("Save changes before marking the draft ready.")
        return attrs


def operation(values):
    return json.loads(json.dumps(values, cls=DjangoJSONEncoder))


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
    platform = draft.inputs.get("platform", "ios")
    fields = fields_for(platform)
    # Reuse the same sourced rules on precisely the proposed localization.
    data = {
        **draft.inputs,
        "ruleset": ruleset_for(platform),
        "metadata": {"locale": draft.locale, **draft.content},
    }
    checks = [check for check in audit(data)["checks"] if check["field"] in fields]
    blocking = [
        check
        for check in checks
        if check["status"] == "issue"
        or (check["id"] == "keywords.length" and check["status"] == "review")
        or (
            check["field"]
            in (
                {"name", "description", "short_description"}
                if platform == "android"
                else {"name", "description", "keywords"}
            )
            and check["status"] == "unavailable"
        )
    ]
    return {
        "checks": checks,
        "can_mark_ready": not blocking,
        "blocking": [check["id"] for check in blocking],
        "ruleset": ruleset_for(platform),
    }


def summary(draft):
    return {
        "id": str(draft.pk),
        "platform": draft.inputs.get("platform", "ios"),
        "name": draft.name,
        "locale": draft.locale,
        "status": draft.status,
        "version": draft.version,
        "updated_at": draft.updated_at,
        "created_at": draft.created_at,
    }


def serialize(draft):
    platform = draft.inputs.get("platform", "ios")
    fields = fields_for(platform)
    baseline = localized_metadata(draft.inputs["metadata"], draft.locale, platform)
    changed = [field for field in fields if draft.content.get(field) != baseline.get(field)]
    latest = draft.app.snapshots.first()
    latest_content = None
    if latest:
        try:
            latest_content = localized_metadata(latest.data, draft.locale, platform)
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
        for field in fields
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


def comparison_seed(app, comparison):
    ids = {comparison["base_audit_id"], *(item["audit_id"] for item in comparison["selections"])}
    runs = {
        run.pk: run
        for run in AuditRun.objects.select_related("workflow").filter(app=app, pk__in=ids)
    }
    if set(runs) != ids:
        raise ValidationError("Choose saved analyses of this app.")
    base = runs[comparison["base_audit_id"]]
    mode = base.inputs.get("mode", "listing")
    platform = base.inputs.get("platform", "ios")
    fields = fields_for(platform)
    for run in runs.values():
        if not run.report or run.workflow.status != "succeeded":
            raise ValidationError("Complete the audit before creating a draft from it.")
        if run.locale != base.locale:
            raise ValidationError("Choose analyses in the same language to compose a draft.")
        if run.inputs.get("platform", "ios") != platform:
            raise ValidationError("Choose analyses for the same store to compose a draft.")
        if mode not in {"project", "listing"} or run.inputs.get("mode", "listing") != mode:
            raise ValidationError("Choose analyses of the same type to compose a draft.")
    if any(item["field"] not in fields for item in comparison["selections"]):
        raise ValidationError("Only fields supported by this store can be selected.")
    if mode == "project" and {item["field"] for item in comparison["selections"]} != set(fields):
        raise ValidationError("Choose a proposal for every listing field.")
    content = localized_metadata(base.inputs["metadata"], base.locale, platform)
    provenance = []
    for selection in comparison["selections"]:
        run = runs[selection["audit_id"]]
        _, proposed, sources, _ = seed(app, selection)
        evidence = next(
            (item for item in sources if item["check"]["field"] == selection["field"]), None
        )
        if evidence is None:
            raise ValidationError("The selected proposal does not match this listing field.")
        content[selection["field"]] = proposed[selection["field"]]
        provenance.append(
            {
                **evidence,
                "model": run.inputs.get("ai", {}).get("model", ""),
                "provider": run.inputs.get("ai", {}).get("provider", ""),
                "snapshot_id": run.inputs["snapshot_id"],
                "locale": run.locale,
                "created_at": run.created_at.isoformat(),
            }
        )
    return base.inputs, content, provenance, "Created from compared analyses"


def seed(app, values):
    provenance = []
    if "comparison" in values:
        return comparison_seed(app, values["comparison"])
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
        if values["check_id"] == "project.listing":
            proposal = run.report.get("project", {})
            if run.inputs.get("mode") != "project" or not proposal.get("accepted"):
                raise ValidationError("This project analysis has no approved listing proposal.")
            content = {item["field"]: item["text"] for item in proposal["fields"]}
            if set(content) != set(fields_for(run.inputs.get("platform", "ios"))):
                raise ValidationError("The listing proposal is incomplete. Start a new analysis.")
            provenance = [
                {
                    "audit_id": str(run.pk),
                    "check": {
                        "id": f"project.{item['field']}",
                        "field": item["field"],
                        "title": LABELS[item["field"]],
                        "observation": item["rationale"],
                        "replacement": item["text"],
                        "evidence": item["evidence"],
                        "sources": item["sources"],
                    },
                }
                for item in proposal["fields"]
            ]
            return run.inputs, content, provenance, "Created from project analysis"
        check = next(
            (check for check in run.report["checks"] if check["id"] == values["check_id"]), None
        )
        if (
            not check
            or check["field"] not in fields_for(run.inputs.get("platform", "ios"))
            or not isinstance(check.get("replacement"), str)
        ):
            raise ValidationError("This finding has no editable proposal.")
        inputs = run.inputs
        provenance = [{"audit_id": str(run.pk), "check": check}]
    else:
        if app.platform not in {"ios", "android"} and not (
            app.origin == "project" and app.platform == "undecided"
        ):
            raise ValidationError("Choose App Store or Google Play.")
        snapshot = get_object_or_404(app.snapshots, pk=values["snapshot_id"])
        if (app.platform == "android" and snapshot.source.startswith("apple_store")) or (
            app.platform == "ios" and snapshot.source.startswith("google_play")
        ):
            raise ValidationError("The imported listing does not match the application's store.")
        inputs = {
            "metadata": snapshot.data,
            "snapshot_id": str(snapshot.pk),
            "captured_at": snapshot.captured_at.isoformat(),
            "locale": values["locale"],
            "source": snapshot.source,
            "platform": "ios" if app.platform == "undecided" else app.platform,
            "is_demo": app.is_demo,
        }
    try:
        content = localized_metadata(
            inputs["metadata"], inputs["locale"], inputs.get("platform", "ios")
        )
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
        if set(values.get("content", {})) - set(fields_for(draft.inputs.get("platform", "ios"))):
            raise ValidationError("Only fields supported by this store can be edited.")
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
    platform = draft.inputs.get("platform", "ios")
    baseline = localized_metadata(draft.inputs["metadata"], draft.locale, platform)
    lines = [
        saved.name,
        f"{store_name(platform)} · {draft.locale} · Revision {version}",
        f"Status: {saved.status}. Not submitted to {publisher(platform)}.",
        f"Reference saved: {draft.inputs['captured_at']}",
        "",
    ]
    for field in fields_for(platform):
        if field in saved.content and saved.content[field] != baseline.get(field):
            lines += [LABELS[field], saved.content[field], ""]
    response = HttpResponse("\n".join(lines), content_type="text/plain; charset=utf-8")
    response["Content-Disposition"] = (
        f'attachment; filename="panda-draft-{draft.pk}-v{version}.txt"'
    )
    response["Cache-Control"] = "no-store"
    return response
