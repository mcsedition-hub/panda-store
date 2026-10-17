import uuid

import pytest

from addons.app_catalog.models import MetadataSnapshot, MobileApp
from addons.aso.models import ListingDraft
from addons.aso.tasks import audit_listing
from panda_store.core.access import activate_modules, deactivate_module
from panda_store.core.models import Membership, Workspace


@pytest.fixture
def listing(workspace):
    activate_modules(workspace, ["aso"])
    app = MobileApp.objects.create(
        workspace=workspace, name="Panda", platform="ios", external_id="panda"
    )
    snapshot = MetadataSnapshot.objects.create(
        app=app,
        fingerprint="original",
        source="apple_store.api",
        data={
            "locale": "en-US",
            "name": "Panda run",
            "subtitle": "Your training diary",
            "description": "Track your runs.",
            "keywords": "run,fitness",
            "promotional_text": "",
            "localizations": [
                {
                    "locale": "en-US",
                    "name": "Panda run",
                    "subtitle": "Your training diary",
                    "description": "Track your runs.",
                    "keywords": "run,fitness",
                    "promotional_text": "",
                },
                {
                    "locale": "fr-CA",
                    "name": "Panda",
                    "description": "Vos courses.",
                    "keywords": "course",
                },
            ],
        },
    )
    return app, snapshot


def base(workspace, suffix):
    return f"/api/workspaces/{workspace.pk}/aso/{suffix}"


def create(api, workspace, listing, **extra):
    app, snapshot = listing
    payload = {
        "name": "Keyword update",
        "locale": "en-US",
        "snapshot_id": str(snapshot.pk),
        "request_id": str(uuid.uuid4()),
        **extra,
    }
    response = api.post(base(workspace, f"apps/{app.pk}/drafts/"), payload, format="json")
    assert response.status_code == 201, response.data
    return response.data, payload


def edit(api, workspace, draft, **changes):
    return api.patch(
        base(workspace, f"drafts/{draft['id']}/"),
        {
            "request_id": str(uuid.uuid4()),
            "version": draft["version"],
            **changes,
        },
        format="json",
    )


def test_create_proposal_keeps_exact_locale_evidence_and_idempotency(api, workspace, listing):
    app, snapshot = listing
    run = api.post(
        base(workspace, f"apps/{app.pk}/runs/"),
        {
            "request_id": str(uuid.uuid4()),
            "locale": "en-US",
            "snapshot_id": str(snapshot.pk),
        },
        format="json",
    ).data
    audit_listing(run["workflow_id"])
    payload = {
        "request_id": str(uuid.uuid4()),
        "name": "Clean keywords",
        "audit_id": run["id"],
        "check_id": "keywords.cleanup",
    }
    url = base(workspace, f"apps/{app.pk}/drafts/")
    response = api.post(url, payload, format="json")
    assert response.status_code == 201, response.data
    draft = response.data
    assert draft["content"]["keywords"] == "fitness"
    assert draft["baseline"]["keywords"] == "run,fitness"
    assert draft["changed_fields"] == ["keywords"]
    assert draft["provenance"][0]["check"]["sources"]
    assert api.post(url, payload, format="json").data["id"] == draft["id"]
    assert ListingDraft.objects.count() == 1
    assert api.post(url, {**payload, "name": "Different"}, format="json").status_code == 409
    assert (
        api.post(
            url,
            {**payload, "request_id": str(uuid.uuid4()), "check_id": "content.review"},
            format="json",
        ).status_code
        == 400
    )
    snapshot.refresh_from_db()
    assert snapshot.data["localizations"][0]["keywords"] == "run,fitness"


def test_revision_conflict_and_lost_response_replay(api, workspace, listing):
    draft, _ = create(api, workspace, listing)
    payload = {
        "request_id": str(uuid.uuid4()),
        "version": 1,
        "content": {"keywords": "fitness,pace"},
    }
    url = base(workspace, f"drafts/{draft['id']}/")
    next = api.patch(url, payload, format="json")
    assert next.status_code == 200 and next.data["version"] == 2
    assert api.patch(url, payload, format="json").data["version"] == 2
    conflict = edit(api, workspace, draft, content={"keywords": "stale"})
    assert conflict.status_code == 409
    assert api.get(url).data["content"]["keywords"] == "fitness,pace"
    assert (
        api.patch(url, {**payload, "content": {"keywords": "tampered"}}, format="json").status_code
        == 409
    )
    assert ListingDraft.objects.get().revisions.count() == 2


def test_invalid_copy_is_saved_but_cannot_be_ready_and_edits_reset_review(api, workspace, listing):
    draft, _ = create(api, workspace, listing)
    result = edit(api, workspace, draft, content={"name": "X" * 31})
    assert result.status_code == 200 and not result.data["validation"]["can_mark_ready"]
    assert edit(api, workspace, result.data, status="ready").status_code == 400
    valid = edit(api, workspace, result.data, content={"name": "Panda"}).data
    assert edit(api, workspace, valid, status="ready", content={"name": "Panda"}).status_code == 400
    ready = edit(api, workspace, valid, status="ready").data
    assert ready["status"] == "ready"
    updated = edit(api, workspace, ready, content={"keywords": "fitness"}).data
    assert updated["status"] == "draft"
    unicode = edit(api, workspace, updated, content={"keywords": "é" * 60}).data
    assert not unicode["validation"]["can_mark_ready"]


def test_refresh_compares_without_rewriting_draft_or_claiming_publication(api, workspace, listing):
    app, snapshot = listing
    draft, _ = create(api, workspace, listing)
    changed = edit(api, workspace, draft, content={"keywords": "fitness"}).data
    newer = MetadataSnapshot.objects.create(
        app=app,
        fingerprint="new",
        source="apple_store.api",
        data={
            "locale": "en-US",
            "name": "Panda run",
            "subtitle": "New subtitle",
            "keywords": "fitness",
            "description": "Track your runs.",
        },
    )
    response = api.get(base(workspace, f"drafts/{draft['id']}/")).data
    assert response["snapshot_id"] == str(snapshot.pk)
    assert response["latest"]["snapshot_id"] == str(newer.pk)
    assert response["content"] == changed["content"]
    assert response["latest"]["all_changes_match"]
    assert "subtitle" in response["latest"]["changed_since_baseline"]
    assert response["status"] == "draft" and "published" not in response
    MetadataSnapshot.objects.create(
        app=app,
        fingerprint="missing-language",
        source="apple_store.api",
        data={"locale": "fr-CA", "name": "Panda"},
    )
    assert api.get(base(workspace, f"drafts/{draft['id']}/")).data["latest"]["content"] is None


def test_duplicate_restore_history_and_pinned_export(api, workspace, listing):
    draft, _ = create(api, workspace, listing)
    changed = edit(
        api, workspace, draft, content={"keywords": "fitness,pace"}, name="Variant A"
    ).data
    ready = edit(api, workspace, changed, status="ready").data
    duplicate = api.post(
        base(workspace, f"apps/{listing[0].pk}/drafts/"),
        {
            "request_id": str(uuid.uuid4()),
            "name": "Variant B",
            "duplicate_id": draft["id"],
            "version": ready["version"],
        },
        format="json",
    )
    assert duplicate.status_code == 201
    assert duplicate.data["status"] == "draft" and duplicate.data["content"] == ready["content"]
    restored = edit(api, workspace, ready, restore_version=1).data
    assert restored["content"] == draft["content"] and restored["version"] == 4
    assert restored["status"] == "draft"
    history = api.get(base(workspace, f"drafts/{draft['id']}/history/")).data
    assert len(history) == 4 and history[0]["reason"] == "Restored revision 1"
    assert history[-1]["content"] == draft["content"]
    export = api.get(base(workspace, f"drafts/{draft['id']}/export/?version=2"))
    assert export.status_code == 200 and "fitness,pace" in export.content.decode()
    assert "Not submitted to Apple" in export.content.decode()
    assert "attachment;" in export["Content-Disposition"]
    assert api.get(base(workspace, f"drafts/{draft['id']}/export/?version=bad")).status_code == 400


def test_workspace_roles_module_and_foreign_sources_are_enforced(api, workspace, listing, owner):
    draft, _ = create(api, workspace, listing)
    other = Workspace.objects.create(name="Another")
    Membership.objects.create(user=owner, workspace=other, role="owner")
    activate_modules(other, ["aso"])
    for suffix in ("", "history/", "export/"):
        assert api.get(base(other, f"drafts/{draft['id']}/{suffix}")).status_code == 404
    wrong = MobileApp.objects.create(
        workspace=workspace, name="Other", platform="ios", external_id="other"
    )
    assert (
        api.post(
            base(workspace, f"apps/{wrong.pk}/drafts/"),
            {
                "name": "Wrong",
                "request_id": str(uuid.uuid4()),
                "locale": "en-US",
                "snapshot_id": str(listing[1].pk),
            },
            format="json",
        ).status_code
        == 404
    )
    Membership.objects.filter(user=owner, workspace=workspace).update(role="viewer")
    assert edit(api, workspace, draft, name="Denied").status_code == 403
    assert api.get(base(workspace, f"drafts/{draft['id']}/history/")).status_code == 200
    deactivate_module(workspace, "aso")
    for suffix in ("", "history/", "export/"):
        assert api.get(base(workspace, f"drafts/{draft['id']}/{suffix}")).status_code == 403


def test_missing_language_and_unknown_fields_never_fall_back(api, workspace, listing):
    url = base(workspace, f"apps/{listing[0].pk}/drafts/")
    assert (
        api.post(
            url,
            {
                "name": "Unknown",
                "request_id": str(uuid.uuid4()),
                "snapshot_id": str(listing[1].pk),
                "locale": "ja",
            },
            format="json",
        ).status_code
        == 400
    )
    draft, _ = create(api, workspace, listing, locale="fr-CA")
    assert "subtitle" not in draft["content"]
    assert edit(api, workspace, draft, content={"unknown": "data"}).status_code == 400


def test_draft_writes_require_csrf(owner, api, workspace, listing):
    from django.test import Client

    draft, _ = create(api, workspace, listing)
    client = Client(enforce_csrf_checks=True)
    client.force_login(owner)
    assert (
        client.patch(
            base(workspace, f"drafts/{draft['id']}/"),
            {"version": 1, "request_id": str(uuid.uuid4()), "name": "Blocked"},
            content_type="application/json",
        ).status_code
        == 403
    )


@pytest.mark.django_db(transaction=True)
def test_two_editors_cannot_overwrite_the_same_version(api, owner, workspace, listing):
    from concurrent.futures import ThreadPoolExecutor

    from django.db import connection, connections
    from rest_framework.test import APIClient

    if connection.vendor != "postgresql":
        pytest.skip("Row-lock concurrency is exercised against PostgreSQL in CI.")
    draft, _ = create(api, workspace, listing)

    def save(value):
        try:
            client = APIClient()
            client.force_authenticate(owner)
            return edit(client, workspace, draft, content={"keywords": value}).status_code
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(save, ["first", "second"]))
    assert sorted(statuses) == [200, 409]
    saved = ListingDraft.objects.get()
    assert saved.version == 2 and saved.revisions.count() == 2
