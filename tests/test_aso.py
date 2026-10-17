import copy
import uuid
from unittest.mock import patch

import pytest

from addons.app_catalog.models import MetadataSnapshot, MobileApp
from addons.aso.models import AuditRun
from addons.aso.rules import RULESET, audit, localized_metadata
from addons.aso.tasks import audit_listing
from panda_store.core.access import activate_modules, deactivate_module
from panda_store.core.models import Membership, Workspace
from panda_store.workflows import services


def inputs(**text):
    return {
        "ruleset": RULESET,
        "platform": "ios",
        "locale": "en-US",
        "snapshot_id": "saved",
        "metadata": {
            "locale": "en-US",
            "name": "Running with Panda",
            "subtitle": "Your training diary",
            "description": "Plan your runs.",
            "promotional_text": "",
            "keywords": "fitness,interval",
            **text,
        },
    }


def checks(data):
    return {check["id"]: check for check in audit(data)["checks"]}


def test_healthy_listing_does_not_invent_optimizations():
    report = audit(inputs())
    assert report["counts"]["issue"] == report["counts"]["recommendation"] == 0
    assert report["counts"]["review"] > 0 and report["counts"]["unavailable"] > 0
    assert all(check["sources"] for check in report["checks"])
    assert all(
        "replacement" not in check or check["replacement"] is None for check in report["checks"]
    )
    assert "score" not in report


def test_precise_limits_missing_data_and_optional_fields():
    found = checks(inputs(name="x" * 31, subtitle="x" * 30, description="x" * 4001))
    assert found["name.length"]["status"] == "issue"
    assert found["subtitle.length"]["status"] == "passed"
    assert found["description.length"]["status"] == "issue"
    assert found["promotional_text.length"]["status"] == "passed"
    data = inputs(name="", description=None)
    found = checks(data)
    assert found["name.length"]["status"] == "issue"
    assert found["description.length"]["status"] == "unavailable"
    data["metadata"]["available_fields"] = ["description"]
    assert checks(data)["name.length"]["status"] == "unavailable"


def test_keyword_cleanup_keeps_phrases_plurals_and_accents():
    data = inputs(keywords="running, fitness,fitness,run,trainings,training plan,café,cafe")
    before = copy.deepcopy(data)
    found = checks(data)["keywords.cleanup"]
    assert found["status"] == "recommendation"
    assert found["replacement"] == "fitness,run,trainings,training plan,café,cafe"
    assert found["removed"] == [
        {"term": "running", "reason": "Already in name"},
        {"term": "fitness", "reason": "Repeated in keywords"},
    ]
    assert data == before
    assert checks(inputs(keywords="running"))["keywords.cleanup"]["replacement"] is None


def test_unicode_keyword_budget_conflict_is_review_not_invented_failure():
    found = checks(inputs(keywords="é" * 60))["keywords.length"]
    assert found["status"] == "review"
    assert "60 characters; 120 UTF-8 bytes" in found["observation"]
    assert len(found["sources"]) == 2
    assert checks(inputs(keywords="x" * 101))["keywords.length"]["status"] == "issue"


def test_localization_never_falls_back_and_screenshot_coverage_is_explicit():
    data = inputs()
    data["metadata"]["localizations"] = [{"locale": "fr-CA", "name": "Panda"}]
    with pytest.raises(ValueError, match="language"):
        audit(data)
    data["locale"] = "fr-CA"
    data["metadata"].update(screenshots_locale="en-US", screenshots=[{"url": "example"}])
    found = checks(data)
    assert found["description.length"]["status"] == "unavailable"
    assert found["screenshots.review"]["status"] == "unavailable"
    assert localized_metadata(data["metadata"], "fr-CA") == {"name": "Panda"}
    data["platform"] = "android"
    with pytest.raises(ValueError, match="store"):
        audit(data)


@pytest.fixture
def listing(api, workspace):
    activate_modules(workspace, ["aso"])
    app = MobileApp.objects.create(
        workspace=workspace,
        name="Panda",
        platform="ios",
        external_id="real-app",
    )
    snapshot = MetadataSnapshot.objects.create(
        app=app,
        source="apple_store.api",
        fingerprint="original",
        data=inputs(keywords="running,fitness")["metadata"],
    )
    return app, snapshot


def endpoint(workspace, app):
    return f"/api/workspaces/{workspace.pk}/aso/apps/{app.pk}/runs/"


def start(api, workspace, listing):
    app, snapshot = listing
    payload = {"request_id": str(uuid.uuid4()), "snapshot_id": str(snapshot.pk), "locale": "en-US"}
    response = api.post(endpoint(workspace, app), payload, format="json")
    assert response.status_code == 202, response.data
    return AuditRun.objects.get(pk=response.data["id"]), payload


def test_audit_is_durable_idempotent_and_independent_of_demo_mode(
    api, workspace, listing, settings
):
    settings.PANDA_DEMO_MODE = False
    run, payload = start(api, workspace, listing)
    audit_listing(str(run.workflow_id))
    audit_listing(str(run.workflow_id))
    run.refresh_from_db()
    assert run.workflow.status == "succeeded"
    assert run.report["counts"]["recommendation"] == 1
    assert len(run.workflow.events.all()) == 9
    assert api.post(endpoint(workspace, listing[0]), payload, format="json").status_code == 200
    assert AuditRun.objects.count() == 1
    assert (
        api.post(
            endpoint(workspace, listing[0]), {**payload, "locale": "fr-CA"}, format="json"
        ).status_code
        == 400
    )
    listing[1].data = inputs(keywords="new terms")["metadata"]
    listing[1].save()
    assert api.get(endpoint(workspace, listing[0])).data[0]["report"] == run.report
    assert api.post(endpoint(workspace, listing[0]), payload, format="json").status_code == 409
    assert run.inputs["metadata"]["keywords"] == "running,fitness"


def test_access_isolation_roles_and_disabled_module(api, workspace, listing, owner):
    run, _ = start(api, workspace, listing)
    other = Workspace.objects.create(name="Another")
    Membership.objects.create(workspace=other, user=owner, role="owner")
    activate_modules(other, ["aso"])
    assert api.get(endpoint(other, listing[0])).status_code == 404
    assert (
        api.post(
            f"/api/workspaces/{other.pk}/aso/runs/{run.pk}/retry/",
            {
                "request_id": str(uuid.uuid4()),
            },
        ).status_code
        == 404
    )
    Membership.objects.filter(workspace=workspace).update(role="viewer")
    assert api.get(endpoint(workspace, listing[0])).status_code == 200
    assert api.post(endpoint(workspace, listing[0]), {}).status_code == 403
    deactivate_module(workspace, "aso")
    assert api.get(endpoint(workspace, listing[0])).status_code == 403
    audit_listing(str(run.workflow_id))
    run.workflow.refresh_from_db()
    assert run.workflow.status == "failed"
    run.refresh_from_db()
    assert run.report is None


def test_snapshot_must_belong_to_app_and_store_must_match(api, workspace, listing):
    app, snapshot = listing
    other = MobileApp.objects.create(
        workspace=workspace, name="Other", platform="ios", external_id="two"
    )
    payload = {"request_id": str(uuid.uuid4()), "snapshot_id": str(snapshot.pk), "locale": "en-US"}
    assert api.post(endpoint(workspace, other), payload, format="json").status_code == 404
    app.platform = "android"
    app.save()
    assert api.post(endpoint(workspace, app), payload, format="json").status_code == 400
    assert not AuditRun.objects.exists()


def test_retry_reuses_checks_and_original_snapshot(api, workspace, listing):
    run, _ = start(api, workspace, listing)
    complete = services.complete_step

    def fail_saving(run_id, token, key, *args, **kwargs):
        if key == "report":
            raise RuntimeError("disk write failed")
        return complete(run_id, token, key, *args, **kwargs)

    with patch("addons.aso.tasks.services.complete_step", side_effect=fail_saving):
        audit_listing(str(run.workflow_id))
    run.refresh_from_db()
    assert run.report is None  # Saving report and terminal state rolled back together.
    assert run.workflow.status == "failed"
    MetadataSnapshot.objects.create(
        app=listing[0],
        source="apple_store.api",
        fingerprint="new",
        data=inputs(keywords="different")["metadata"],
    )
    retry_url = f"/api/workspaces/{workspace.pk}/aso/runs/{run.pk}/retry/"
    payload = {"request_id": str(uuid.uuid4())}
    response = api.post(retry_url, payload, format="json")
    assert response.status_code == 202
    retry = AuditRun.objects.get(pk=response.data["id"])
    with patch("addons.aso.tasks.audit") as rules:
        audit_listing(str(retry.workflow_id))
    rules.assert_not_called()
    retry.refresh_from_db()
    assert retry.workflow.status == "succeeded"
    assert retry.report["snapshot_id"] == str(listing[1].pk)
    assert retry.workflow.steps.get(key="checks").reused_from_id is not None
    assert api.post(retry_url, payload, format="json").data["id"] == str(retry.pk)
    assert AuditRun.objects.count() == 2


def test_cancel_discards_report_and_broker_failure_is_visible(
    api, workspace, listing, django_capture_on_commit_callbacks
):
    run, _ = start(api, workspace, listing)
    engine = audit

    def cancel_during_checks(data):
        services.cancel(run.workflow_id)
        return engine(data)

    with patch("addons.aso.tasks.audit", side_effect=cancel_during_checks):
        audit_listing(str(run.workflow_id))
    run.refresh_from_db()
    assert run.workflow.status == "canceled" and run.report is None
    with patch("addons.aso.views.audit_listing.delay", side_effect=RuntimeError("unavailable")):
        with django_capture_on_commit_callbacks(execute=True):
            failed, _ = start(api, workspace, listing)
    failed.workflow.refresh_from_db()
    assert failed.workflow.status == "failed"
    assert "task service" in failed.workflow.error


@pytest.mark.django_db(transaction=True)
def test_database_worker_executes_aso(api, workspace, listing, settings):
    from panda_store.workflows.worker import tick

    settings.PANDA_WORKFLOW_DISPATCH = "database"
    run, _ = start(api, workspace, listing)
    assert tick()
    run.refresh_from_db()
    assert run.workflow.status == "succeeded" and run.report
