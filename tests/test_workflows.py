import asyncio
import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.db import close_old_connections, connection
from django.test import AsyncClient, Client
from django.utils import timezone

from addons.studio.models import GenerationRun
from addons.studio.providers import generate_demo_scripts
from addons.studio.tasks import generate_scripts
from panda_store.core.access import deactivate_module
from panda_store.core.models import Membership, Workspace
from panda_store.workflows import services
from panda_store.workflows.models import WorkflowRun


@pytest.fixture
def queued(api, workspace, imported):
    response = api.post(
        f"/api/workspaces/{workspace.pk}/studio/apps/{imported['id']}/runs/",
        {"request_id": str(uuid.uuid4())},
    )
    return GenerationRun.objects.get(pk=response.data["id"])


def endpoint(run, suffix=""):
    return f"/api/workspaces/{run.workspace_id}/workflows/{run.workflow_id}/{suffix}"


def retry(api, run):
    return api.post(
        f"/api/workspaces/{run.workspace_id}/studio/runs/{run.pk}/retry/",
        {"request_id": str(uuid.uuid4())},
    )


def test_real_steps_and_events_are_persisted_without_exposing_checkpoints(api, queued):
    generate_scripts(str(queued.pk))
    data = api.get(endpoint(queued)).json()
    assert data["status"] == "succeeded"
    assert [step["status"] for step in data["steps"]] == ["succeeded"] * 3
    assert data["steps"][1]["depends_on"] == ["context"]
    assert all(step["started_at"] and step["completed_at"] for step in data["steps"])
    assert [event["sequence"] for event in data["events"]] == list(range(1, 10))
    assert [event["kind"] for event in data["events"]].count("step_completed") == 3
    assert all("output" not in step for step in data["steps"])
    assert "inputs" not in data and "lease_token" not in data
    generate_scripts(str(queued.pk))
    assert api.get(endpoint(queued)).json() == data
    assert queued.creatives.count() == 3


def test_event_cursor_and_stream_replay(api, queued):
    generate_scripts(str(queued.pk))
    assert api.get(endpoint(queued) + "?after=bad").status_code == 400
    assert api.get(endpoint(queued) + "?after=-1").status_code == 400
    response = api.get(
        endpoint(queued, "events/?after=1"), HTTP_LAST_EVENT_ID="6", HTTP_ACCEPT="text/event-stream"
    )
    assert response["Content-Type"] == "text/event-stream"
    assert response["Cache-Control"] == "no-store"
    content = b"".join(response.streaming_content).decode()
    data = json.loads(content.split("data: ")[1].strip())
    assert [event["sequence"] for event in data["events"]] == [7, 8, 9]
    assert "id: 9\n" in content
    assert api.get(endpoint(queued) + "?after=9").json()["events"] == []


def test_cancel_before_start_and_duplicate_stop_are_safe(api, queued):
    assert api.post(endpoint(queued, "cancel/")).json()["status"] == "canceled"
    first = api.get(endpoint(queued)).json()
    assert api.post(endpoint(queued, "cancel/")).json() == first
    with patch("addons.studio.tasks.generate_demo_scripts") as provider:
        generate_scripts(str(queued.pk))
    provider.assert_not_called()
    assert not queued.creatives.exists()


def test_cancel_during_provider_discards_late_result(api, queued):
    def provider(inputs):
        services.cancel(queued.workflow_id)
        assert WorkflowRun.objects.get(pk=queued.workflow_id).status == "canceling"
        return generate_demo_scripts(inputs)

    with patch("addons.studio.tasks.generate_demo_scripts", side_effect=provider):
        generate_scripts(str(queued.pk))
    data = api.get(endpoint(queued)).json()
    assert data["status"] == "canceled"
    assert [step["status"] for step in data["steps"]] == ["succeeded", "canceled", "skipped"]
    assert not queued.creatives.exists()


def test_retry_reuses_completed_outputs_and_keeps_previous_trace(api, queued):
    with patch(
        "addons.studio.tasks.Creative.objects.bulk_create", side_effect=RuntimeError("private")
    ):
        generate_scripts(str(queued.pk))
    previous = api.get(endpoint(queued)).json()
    assert previous["status"] == "failed"
    assert "private" not in json.dumps(previous)
    response = retry(api, queued)
    assert response.status_code == 202
    next_run = GenerationRun.objects.get(pk=response.data["id"])
    assert next_run.inputs == queued.inputs
    assert retry(api, queued).data["id"] == str(next_run.pk)
    assert GenerationRun.objects.count() == 2
    with patch("addons.studio.tasks.generate_demo_scripts") as provider:
        generate_scripts(str(next_run.pk))
    provider.assert_not_called()
    assert next_run.creatives.count() == 3
    data = api.get(endpoint(next_run)).json()
    assert data["status"] == "succeeded" and data["retry_of"] == str(queued.workflow_id)
    assert all(step["reused_from_id"] for step in data["steps"][:2])
    assert api.get(endpoint(queued)).json() == previous
    assert retry(api, next_run).status_code == 400


def test_expired_worker_cannot_commit_after_recovery(api, queued):
    token = services.claim(queued.workflow_id)
    services.start_step(queued.workflow_id, token, "context", "Reading saved metadata.")
    WorkflowRun.objects.filter(pk=queued.workflow_id).update(
        lease_expires_at=timezone.now() - timedelta(seconds=1)
    )
    assert services.heartbeat(queued.workflow_id, token) == 0
    data = api.get(endpoint(queued)).json()
    assert data["status"] == "failed" and "stopped responding" in data["error"]
    with pytest.raises(services.ExecutionStopped):
        services.complete_step(queued.workflow_id, token, "context", "Late result")
    assert retry(api, queued).status_code == 202
    assert not queued.creatives.exists()


def test_missing_worker_is_reported_and_can_be_retried(api, queued):
    WorkflowRun.objects.filter(pk=queued.workflow_id).update(
        created_at=timezone.now() - timedelta(minutes=6)
    )
    data = api.get(endpoint(queued)).json()
    assert data["status"] == "failed" and "No worker" in data["error"]
    assert retry(api, queued).status_code == 202


def test_dispatch_failure_is_recorded(api, workspace, imported, django_capture_on_commit_callbacks):
    with patch(
        "addons.studio.views.generate_scripts.delay", side_effect=RuntimeError("broker secret")
    ):
        with django_capture_on_commit_callbacks(execute=True):
            response = api.post(
                f"/api/workspaces/{workspace.pk}/studio/apps/{imported['id']}/runs/",
                {"request_id": str(uuid.uuid4())},
            )
    run = GenerationRun.objects.get(pk=response.data["id"])
    data = api.get(endpoint(run)).json()
    assert data["status"] == "failed" and data["completed_at"]
    assert "broker secret" not in json.dumps(data)


def test_workflow_access_roles_module_and_csrf(api, queued, owner):
    outside = Workspace.objects.create(name="Outside")
    Membership.objects.create(workspace=outside, user=owner, role="owner")
    forged = endpoint(queued).replace(str(queued.workspace_id), str(outside.pk))
    for suffix in ["", "events/"]:
        assert api.get(forged + suffix).status_code == 404
    assert api.post(forged + "cancel/").status_code == 404
    Membership.objects.filter(workspace=queued.workspace).update(role="viewer")
    assert api.get(endpoint(queued)).status_code == 200
    assert api.post(endpoint(queued, "cancel/")).status_code == 403
    assert retry(api, queued).status_code == 403
    Membership.objects.filter(workspace=queued.workspace).update(role="owner")
    client = Client(enforce_csrf_checks=True)
    client.force_login(owner)
    assert client.post(endpoint(queued, "cancel/")).status_code == 403
    deactivate_module(queued.workspace, "studio")
    for suffix in ["", "events/"]:
        assert api.get(endpoint(queued, suffix)).status_code == 403
    assert api.post(endpoint(queued, "cancel/")).status_code == 403
    assert retry(api, queued).status_code == 403


def test_open_stream_rechecks_membership(api, queued):
    response = api.get(endpoint(queued, "events/"))
    iterator = iter(response.streaming_content)
    assert b"Waiting for a worker" in next(iterator)
    Membership.objects.filter(workspace=queued.workspace).delete()
    with patch("panda_store.workflows.views.time.sleep"):
        assert next(iterator) == b"event: unavailable\ndata: {}\n\n"
    response.close()


@pytest.mark.django_db(transaction=True)
def test_asgi_stream_returns_events(owner, workspace, imported, api):
    # With autocommit, the eager dispatch runs before the response.
    response = api.post(
        f"/api/workspaces/{workspace.pk}/studio/apps/{imported['id']}/runs/",
        {"request_id": str(uuid.uuid4())},
    )
    run = GenerationRun.objects.get(pk=response.data["id"])
    client = AsyncClient()
    client.force_login(owner)

    async def read():
        response = await client.get(
            endpoint(run, "events/"), headers={"Accept": "text/event-stream"}
        )
        assert response.status_code == 200 and response.is_async
        return b"".join([chunk async for chunk in response.streaming_content])

    assert b'"status": "succeeded"' in asyncio.run(read())


@pytest.mark.django_db(transaction=True)
def test_parallel_deliveries_only_execute_once(api, workspace, imported, settings):
    if connection.vendor != "postgresql":
        pytest.skip("Row-lock concurrency is checked with PostgreSQL in CI.")
    with patch("addons.studio.views.generate_scripts.delay"):
        response = api.post(
            f"/api/workspaces/{workspace.pk}/studio/apps/{imported['id']}/runs/",
            {"request_id": str(uuid.uuid4())},
        )
    run = GenerationRun.objects.get(pk=response.data["id"])

    def deliver():
        close_old_connections()
        try:
            generate_scripts(str(run.pk))
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda _: deliver(), range(2)))
    assert run.creatives.count() == 3
    assert run.workflow.events.filter(kind="started").count() == 1


def test_database_worker_executes_without_a_broker(
    api, workspace, imported, settings, django_capture_on_commit_callbacks
):
    from panda_store.workflows.worker import tick

    settings.PANDA_WORKFLOW_DISPATCH = "database"
    with patch("addons.studio.views.generate_scripts.delay") as dispatch:
        with django_capture_on_commit_callbacks(execute=True):
            response = api.post(
                f"/api/workspaces/{workspace.pk}/studio/apps/{imported['id']}/runs/",
                {"request_id": str(uuid.uuid4())},
            )
        dispatch.assert_not_called()
    run = GenerationRun.objects.get(pk=response.data["id"])
    assert run.workflow.status == "queued"
    assert tick() is True
    assert api.get(endpoint(run)).json()["status"] == "succeeded"
    assert tick() is False


def test_event_pagination_does_not_skip_older_activity(api, queued):
    from django.db import transaction

    with transaction.atomic():
        run = WorkflowRun.objects.select_for_update().get(pk=queued.workflow_id)
        for index in range(115):
            services._event(run, "observation", f"Checked item {index}.")
    first = api.get(endpoint(queued)).json()
    assert len(first["events"]) == first["cursor"] == 100
    assert first["has_more"]
    second = api.get(endpoint(queued) + "?after=100").json()
    assert second["cursor"] == 116 and not second["has_more"]
    assert [event["sequence"] for event in second["events"]] == list(range(101, 117))
