import uuid
from unittest.mock import patch

from django.test import Client

from addons.app_catalog.models import MetadataSnapshot, MobileApp
from addons.studio.models import Creative, GenerationRun
from addons.studio.tasks import generate_scripts
from panda_store.core.access import activate_modules, deactivate_module
from panda_store.core.models import Membership, User, Workspace


def url(workspace, suffix):
    return f"/api/workspaces/{workspace.pk}/{suffix}"


def test_login_csrf_and_session_isolation(owner, workspace):
    client = Client(enforce_csrf_checks=True)
    assert client.get("/api/workspaces/").status_code == 403
    credentials = {"username": "owner", "password": "local-test-password"}
    assert (
        client.post("/api/session/login/", credentials, content_type="application/json").status_code
        == 403
    )
    token = client.get("/api/session/").json()["csrf_token"]
    response = client.post(
        "/api/session/login/",
        credentials,
        content_type="application/json",
        HTTP_X_CSRFTOKEN=token,
    )
    assert response.status_code == 200
    assert client.get("/api/workspaces/").json()[0]["id"] == str(workspace.pk)
    assert client.post(url(workspace, "modules/example/")).status_code == 403
    token = response.json()["csrf_token"]
    assert client.post("/api/session/logout/", HTTP_X_CSRFTOKEN=token).status_code == 200
    assert client.get("/api/workspaces/").status_code == 403


def test_import_is_idempotent_and_scoped(api, workspace, imported, owner):
    response = api.post(url(workspace, "apple_store/import/"), {"external_id": "demo.runclub"})
    assert response.status_code == 200
    assert response.data["id"] == imported["id"]
    assert MobileApp.objects.count() == MetadataSnapshot.objects.count() == 1
    other = Workspace.objects.create(name="Other owned workspace")
    Membership.objects.create(user=owner, workspace=other, role="owner")
    activate_modules(other, ["apple_store"])
    response = api.post(url(other, "apple_store/import/"), {"external_id": "demo.runclub"})
    assert response.status_code == 201
    assert response.data["id"] != imported["id"]


def test_module_activation_enforces_roles_and_dependencies(api, workspace):
    endpoint = url(workspace, "modules/example/")
    assert api.get(url(workspace, "example/hello/")).status_code == 403
    assert api.post(endpoint).status_code == 200
    assert api.get(url(workspace, "example/hello/")).status_code == 200
    assert api.delete(url(workspace, "modules/app_catalog/")).status_code == 400
    assert api.delete(endpoint).status_code == 204
    assert api.get(url(workspace, "example/hello/")).status_code == 403
    assert api.post(url(workspace, "modules/missing/")).status_code == 400
    membership = Membership.objects.get(workspace=workspace)
    membership.role = "editor"
    membership.save()
    assert api.post(endpoint).status_code == 403


def test_planned_module_is_listed_but_cannot_be_enabled(api, workspace, monkeypatch):
    from dataclasses import replace

    from panda_store.core.registry import get_registry

    registry = get_registry()
    monkeypatch.setitem(
        registry.modules, "aso", replace(registry.modules["aso"], availability="planned")
    )
    planned = next(item for item in api.get(url(workspace, "modules/")).data if item["id"] == "aso")
    assert planned["availability"] == "planned" and not planned["enabled"]
    before = set(workspace.modules.values_list("module_id", flat=True))
    assert api.post(url(workspace, "modules/aso/")).status_code == 400
    assert set(workspace.modules.values_list("module_id", flat=True)) == before


def test_disabling_modules_blocks_actions_and_preserves_imported_apps(api, workspace, imported):
    deactivate_module(workspace, "apple_store")
    for method, suffix, data in [
        ("get", "catalog/", None),
        ("get", "connections/", None),
        ("post", "import/", {"external_id": "demo.pause"}),
        ("post", f"apps/{imported['id']}/sync/", {}),
    ]:
        assert (
            getattr(api, method)(url(workspace, "apple_store/" + suffix), data).status_code == 403
        )
    assert api.get(url(workspace, "app_catalog/apps/")).data[0]["id"] == imported["id"]
    deactivate_module(workspace, "studio")
    base = url(workspace, f"studio/apps/{imported['id']}/")
    assert api.get(base + "brief/").status_code == 403
    assert api.get(base + "runs/").status_code == 403
    assert api.post(base + "runs/", {"request_id": str(uuid.uuid4())}).status_code == 403


def test_queued_generation_checks_module_activation_when_worker_starts(api, workspace, imported):
    response = api.post(
        url(workspace, f"studio/apps/{imported['id']}/runs/"),
        {"request_id": str(uuid.uuid4())},
    )
    run = GenerationRun.objects.get(pk=response.data["id"])
    assert run.status == "queued"
    deactivate_module(workspace, "studio")
    with patch("addons.studio.tasks.generate_demo_scripts") as provider:
        generate_scripts(str(run.pk))
    provider.assert_not_called()
    run.refresh_from_db()
    assert run.status == "failed" and run.completed_at
    assert "disabled" in run.error and not run.creatives.exists()
    activate_modules(workspace, ["studio"])
    generate_scripts(str(run.pk))
    assert not run.creatives.exists()


def test_cross_workspace_access_is_denied(api, workspace, imported):
    outside = Workspace.objects.create(name="Someone else's workspace")
    for suffix in ("modules/", "app_catalog/apps/", "studio/apps/" + imported["id"] + "/brief/"):
        assert api.get(url(outside, suffix)).status_code == 404
    intruder = User.objects.create_user(username="intruder")
    api.force_authenticate(intruder)
    assert api.get(url(workspace, f"app_catalog/apps/{imported['id']}/")).status_code == 404


def test_viewer_cannot_import_or_generate(api, workspace, imported):
    Membership.objects.filter(workspace=workspace).update(role="viewer")
    assert api.get(url(workspace, "app_catalog/apps/")).status_code == 200
    assert (
        api.post(url(workspace, "apple_store/import/"), {"external_id": "demo.pause"}).status_code
        == 403
    )
    base = url(workspace, f"studio/apps/{imported['id']}/")
    assert api.put(base + "brief/", {"goal": "Changed"}).status_code == 403
    assert api.post(base + "runs/", {"request_id": str(uuid.uuid4())}).status_code == 403


def test_demo_provider_requires_explicit_opt_in(api, workspace, imported, settings):
    settings.PANDA_DEMO_MODE = False
    assert api.get(url(workspace, "apple_store/catalog/")).status_code == 403
    assert (
        api.post(url(workspace, "apple_store/import/"), {"external_id": "demo.pause"}).status_code
        == 403
    )
    assert (
        api.post(
            url(workspace, f"studio/apps/{imported['id']}/runs/"),
            {
                "request_id": str(uuid.uuid4()),
            },
        ).status_code
        == 403
    )


def test_generation_edit_approval_export_and_retries(
    api, workspace, imported, django_capture_on_commit_callbacks, owner
):
    base = url(workspace, f"studio/apps/{imported['id']}/")
    brief = {"audience": "Les débutants", "goal": "Découvrir Runclub", "tone": "Amical"}
    assert api.put(base + "brief/", brief, format="json").status_code == 200
    request = {"request_id": str(uuid.uuid4())}
    with django_capture_on_commit_callbacks(execute=True):
        response = api.post(base + "runs/", request, format="json")
    assert response.status_code == 202
    run = GenerationRun.objects.get(pk=response.data["id"])
    assert run.status == "succeeded"
    assert run.inputs["brief"]["audience"] == brief["audience"]
    assert run.creatives.count() == 3
    assert api.post(base + "runs/", request, format="json").status_code == 200
    generate_scripts(str(run.pk))
    assert GenerationRun.objects.count() == 1
    assert Creative.objects.count() == 3
    creative = run.creatives.first()
    endpoint = url(workspace, f"studio/creatives/{creative.pk}/")
    assert api.patch(endpoint, {"approved": True}, format="json").data["approved"] is True
    response = api.patch(endpoint, {"hook": "Mon nouvel angle", "approved": True}, format="json")
    assert response.data["approved"] is False
    export = api.get(url(workspace, f"studio/runs/{run.pk}/export/"))
    assert export.status_code == 200
    assert "Mon nouvel angle" in export.content.decode()
    assert "needs review" in export.content.decode()
    other = Workspace.objects.create(name="Other owned workspace")
    Membership.objects.create(user=owner, workspace=other, role="owner")
    activate_modules(other, ["studio"])
    assert (
        api.patch(url(other, f"studio/creatives/{creative.pk}/"), {"approved": True}).status_code
        == 404
    )
    assert api.get(url(other, f"studio/runs/{run.pk}/export/")).status_code == 404
    assert api.put(base + "brief/", {**brief, "goal": "New goal"}, format="json").status_code == 200
    assert api.post(base + "runs/", request, format="json").status_code == 409
    Membership.objects.filter(workspace=workspace).update(role="viewer")
    assert api.patch(endpoint, {"approved": True}).status_code == 403


def test_broker_failure_is_visible(api, workspace, imported, django_capture_on_commit_callbacks):
    endpoint = url(workspace, f"studio/apps/{imported['id']}/runs/")
    with patch("addons.studio.views.generate_scripts.delay", side_effect=RuntimeError("offline")):
        with django_capture_on_commit_callbacks(execute=True):
            api.post(endpoint, {"request_id": str(uuid.uuid4())}, format="json")
    result = api.get(endpoint).data[0]
    assert result["status"] == "failed"
    assert "unavailable" in result["error"]


def test_failed_generation_can_be_retried_as_new_run(
    api, workspace, imported, django_capture_on_commit_callbacks
):
    endpoint = url(workspace, f"studio/apps/{imported['id']}/runs/")
    with patch("addons.studio.tasks.generate_demo_scripts", side_effect=ValueError("broken")):
        with django_capture_on_commit_callbacks(execute=True):
            api.post(endpoint, {"request_id": str(uuid.uuid4())}, format="json")
    assert GenerationRun.objects.get().status == "failed"
    assert Creative.objects.count() == 0
    with django_capture_on_commit_callbacks(execute=True):
        api.post(endpoint, {"request_id": str(uuid.uuid4())}, format="json")
    assert GenerationRun.objects.filter(status="succeeded").count() == 1
