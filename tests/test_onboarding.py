from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch

import pytest
from django.core.management import call_command
from django.db import close_old_connections, connection
from django.test import Client
from rest_framework.test import APIClient

from addons.app_catalog.models import MobileApp
from panda_store.core.models import Installation, Membership, User, Workspace


@pytest.fixture(autouse=True)
def enable_setup(settings):
    settings.PANDA_SETUP_ENABLED = True
    settings.PANDA_DEMO_USERNAME = "demo"


@pytest.fixture
def details():
    return {
        "organization_name": "Northstar Studio",
        "username": "northstar",
        "email": "owner@example.test",
        "password": "Papaya!ridge-93.rail",
        "password_confirmation": "Papaya!ridge-93.rail",
    }


@pytest.fixture
def setup_client(db):
    client = Client(enforce_csrf_checks=True)
    token = client.get("/api/session/").json()["csrf_token"]
    client.defaults["HTTP_X_CSRFTOKEN"] = token
    return client


def submit(client, details):
    return client.post("/api/setup/", details, content_type="application/json")


def test_setup_saves_local_owner_and_workspace_and_opens_session(setup_client, details):
    initial = setup_client.get("/api/session/").json()
    assert initial["setup_required"] is True
    assert initial["user"] is None
    assert setup_client.get("/api/setup/").status_code == 405
    assert Client(enforce_csrf_checks=True).post("/api/setup/").status_code == 403
    response = submit(setup_client, details)
    assert response.status_code == 200
    assert response.json()["setup_required"] is False
    owner = User.objects.get(username=details["username"])
    assert owner.email == details["email"]
    assert owner.password != details["password"]
    assert owner.check_password(details["password"])
    assert not owner.is_staff and not owner.is_superuser
    assert details["password"] not in response.content.decode()
    installation = Installation.objects.get()
    assert installation.owner == owner
    assert installation.workspace.name == details["organization_name"]
    assert Membership.objects.get(user=owner).role == "owner"
    assert set(installation.workspace.modules.values_list("module_id", flat=True)) == {
        "app_catalog",
        "apple_store",
        "studio",
    }
    assert setup_client.get("/api/workspaces/").json()[0]["name"] == details["organization_name"]
    assert setup_client.get("/api/session/").json()["user"]["id"] == str(owner.pk)
    visitor = Client(enforce_csrf_checks=True)
    session = visitor.get("/api/session/").json()
    assert session["setup_required"] is False
    assert session["user"] is None
    assert visitor.get("/api/workspaces/").status_code == 403
    assert (
        visitor.post(
            "/api/session/login/",
            {"username": details["username"], "password": details["password"]},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=session["csrf_token"],
        ).status_code
        == 200
    )


def test_setup_cannot_be_repeated_or_reset_by_a_new_visitor(setup_client, details):
    assert submit(setup_client, details).status_code == 200
    visitor = Client()
    assert submit(visitor, {**details, "username": "intruder"}).status_code == 409
    assert User.objects.count() == Workspace.objects.count() == Installation.objects.count() == 1
    assert User.objects.get().username == details["username"]


@pytest.mark.parametrize(
    "invalid",
    [
        {"organization_name": "   "},
        {"email": "invalid"},
        {"username": "with spaces"},
        {"password": "password", "password_confirmation": "password"},
        {"password_confirmation": "different-password"},
    ],
)
def test_invalid_setup_does_not_create_partial_accounts(setup_client, details, invalid):
    assert submit(setup_client, {**details, **invalid}).status_code == 400
    assert not Installation.objects.exists()
    assert not User.objects.exists()
    assert not Workspace.objects.exists()


def test_setup_failure_rolls_back_and_can_be_retried(setup_client, details):
    with patch("panda_store.core.onboarding.activate_modules", side_effect=RuntimeError("failed")):
        with pytest.raises(RuntimeError):
            submit(setup_client, details)
    assert not Installation.objects.exists()
    assert not User.objects.exists()
    assert not Workspace.objects.exists()
    assert submit(setup_client, details).status_code == 200


def test_setup_upgrades_seeded_demo_without_losing_imports(setup_client, details, monkeypatch):
    monkeypatch.setenv("PANDA_DEMO_USERNAME", "demo")
    monkeypatch.setenv("PANDA_DEMO_PASSWORD", "old-random-demo-password-123")
    call_command("seed_demo")
    owner, workspace = User.objects.get(), Workspace.objects.get()
    api = APIClient()
    api.force_authenticate(owner)
    imported = api.post(
        f"/api/workspaces/{workspace.pk}/apple_store/import/", {"external_id": "demo.runclub"}
    )
    assert imported.status_code == 201
    assert setup_client.get("/api/session/").json()["setup_required"] is True
    assert submit(setup_client, details).status_code == 200
    owner.refresh_from_db()
    workspace.refresh_from_db()
    assert owner.username == details["username"]
    assert owner.check_password(details["password"])
    assert workspace.name == details["organization_name"]
    assert MobileApp.objects.get(pk=imported.data["id"]).workspace == workspace
    assert User.objects.count() == Workspace.objects.count() == 1


def test_existing_account_installation_cannot_be_claimed(owner, workspace, details):
    client = Client()
    assert client.get("/api/session/").json()["setup_required"] is False
    assert submit(client, details).status_code == 409
    owner.refresh_from_db()
    assert owner.username == "owner"
    assert not Installation.objects.exists()


def test_setup_can_be_disabled_by_operator(setup_client, details, settings):
    settings.PANDA_SETUP_ENABLED = False
    assert setup_client.get("/api/session/").json()["setup_required"] is False
    assert submit(setup_client, details).status_code == 409
    assert not User.objects.exists()


@pytest.mark.django_db(transaction=True)
def test_concurrent_setup_commits_only_one_owner(details):
    if connection.vendor != "postgresql":
        pytest.skip("Concurrent setup is tested against PostgreSQL in CI.")
    barrier = Barrier(2)

    def attempt(index):
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            return submit(Client(), {**details, "username": f"owner-{index}"}).status_code
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(attempt, [1, 2]))
    assert sorted(statuses) == [200, 409]
    assert User.objects.count() == Workspace.objects.count() == Installation.objects.count() == 1
