import pytest
from django.test import Client

from panda_store.core.models import User


def test_language_is_saved_during_onboarding_and_restored_at_login(db, settings):
    settings.PANDA_SETUP_ENABLED = True
    client = Client(enforce_csrf_checks=True)
    initial = client.get("/api/session/").json()
    assert initial["language"] is None
    credentials = {"username": "francophone", "password": "Papaya!ridge-93.rail"}
    response = client.post(
        "/api/setup/",
        {
            **credentials,
            "organization_name": "Mon équipe",
            "email": "owner@example.test",
            "password_confirmation": credentials["password"],
            "language": "fr",
        },
        content_type="application/json",
        HTTP_X_CSRFTOKEN=initial["csrf_token"],
    )
    assert response.status_code == 200
    assert response.json()["language"] == "fr"
    assert User.objects.get().language == "fr"
    visitor = Client(enforce_csrf_checks=True)
    token = visitor.get("/api/session/").json()["csrf_token"]
    login = visitor.post(
        "/api/session/login/", credentials, content_type="application/json", HTTP_X_CSRFTOKEN=token
    )
    assert login.json()["language"] == "fr"
    assert visitor.get("/api/session/").json()["language"] == "fr"


def test_preferences_are_private_to_the_signed_in_user(owner):
    other = User.objects.create_user(username="other", language="en")
    client = Client(enforce_csrf_checks=True)
    client.force_login(owner)
    token = client.get("/api/session/").json()["csrf_token"]
    assert owner.language == "en"
    for language in ("fr", "en"):
        response = client.patch(
            "/api/session/preferences/",
            {"language": language},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=token,
        )
        assert response.status_code == 200
        assert response.json() == {"language": language}
        owner.refresh_from_db()
        assert owner.language == language
        assert client.get("/api/session/").json()["language"] == language
    other.refresh_from_db()
    assert other.language == "en"


@pytest.mark.parametrize("value", ["de", "", None, ["fr"]])
def test_invalid_language_does_not_change_preferences(api, owner, value):
    response = api.patch("/api/session/preferences/", {"language": value}, format="json")
    assert response.status_code == 400
    owner.refresh_from_db()
    assert owner.language == "en"


def test_language_preference_requires_login_and_csrf(owner):
    client = Client(enforce_csrf_checks=True)
    assert (
        client.patch(
            "/api/session/preferences/", {"language": "fr"}, content_type="application/json"
        ).status_code
        == 403
    )
    client.force_login(owner)
    assert (
        client.patch(
            "/api/session/preferences/", {"language": "fr"}, content_type="application/json"
        ).status_code
        == 403
    )
    owner.refresh_from_db()
    assert owner.language == "en"
