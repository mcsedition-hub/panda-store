import pytest
from django.test import Client

from panda_store.core.models import Workspace


def test_local_entry_opens_real_workspace_and_keeps_csrf_and_isolation(owner, workspace, settings):
    settings.PANDA_LOCAL_ACCESS = True
    settings.PANDA_LOCAL_USERNAME = owner.username
    outside = Workspace.objects.create(name="Another workshop")
    client = Client(enforce_csrf_checks=True)
    initial = client.get("/api/session/").json()
    assert initial["local_access"] is True
    assert initial["user"] is None
    assert client.get("/api/session/local/").status_code == 405
    assert client.get("/api/workspaces/").status_code == 403
    assert client.post("/api/session/local/").status_code == 403
    response = client.post("/api/session/local/", HTTP_X_CSRFTOKEN=initial["csrf_token"])
    assert response.status_code == 200
    session = response.json()
    assert session["user"]["id"] == str(owner.pk)
    assert client.get("/api/workspaces/").json()[0]["id"] == str(workspace.pk)
    assert client.get(f"/api/workspaces/{outside.pk}/modules/").status_code == 404
    endpoint = f"/api/workspaces/{workspace.pk}/apple_store/import/"
    assert client.post(endpoint, {"external_id": "demo.runclub"}).status_code == 403
    response = client.post(
        endpoint,
        {"external_id": "demo.runclub"},
        content_type="application/json",
        HTTP_X_CSRFTOKEN=session["csrf_token"],
    )
    assert response.status_code == 201
    assert response.json()["name"] == "Runclub"
    assert client.get("/api/session/").json()["user"]["id"] == str(owner.pk)


def test_local_entry_is_disabled_in_account_mode(owner, settings):
    settings.PANDA_LOCAL_ACCESS = False
    settings.PANDA_LOCAL_USERNAME = owner.username
    client = Client(enforce_csrf_checks=True)
    session = client.get("/api/session/").json()
    assert session["local_access"] is False
    assert (
        client.post("/api/session/local/", HTTP_X_CSRFTOKEN=session["csrf_token"]).status_code
        == 403
    )
    assert client.get("/api/session/").json()["user"] is None


@pytest.mark.parametrize("unavailable", ["missing", "inactive", "staff", "superuser"])
def test_local_entry_never_falls_back_to_another_or_privileged_account(
    owner, settings, unavailable
):
    settings.PANDA_LOCAL_ACCESS = True
    settings.PANDA_LOCAL_USERNAME = "missing" if unavailable == "missing" else owner.username
    if unavailable == "inactive":
        owner.is_active = False
    elif unavailable == "staff":
        owner.is_staff = True
    elif unavailable == "superuser":
        owner.is_superuser = True
    owner.save()
    client = Client()
    assert client.post("/api/session/local/").status_code == 503
    assert client.get("/api/session/").json()["user"] is None
