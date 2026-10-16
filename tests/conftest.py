import pytest
from rest_framework.test import APIClient

from panda_store.core.access import activate_modules
from panda_store.core.models import Membership, User, Workspace


@pytest.fixture
def owner(db):
    return User.objects.create_user(username="owner", password="local-test-password")


@pytest.fixture
def workspace(owner):
    workspace = Workspace.objects.create(name="Test workshop")
    Membership.objects.create(user=owner, workspace=workspace, role="owner")
    activate_modules(workspace, ["apple_store", "studio"])
    return workspace


@pytest.fixture
def api(owner):
    client = APIClient()
    client.force_authenticate(owner)
    return client


@pytest.fixture
def imported(api, workspace):
    response = api.post(
        f"/api/workspaces/{workspace.pk}/apple_store/import/",
        {"external_id": "demo.runclub"},
        format="json",
    )
    assert response.status_code == 201, response.data
    return response.data
