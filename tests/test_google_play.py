import io
import json
import time
import uuid
from datetime import timedelta
from unittest.mock import patch
from urllib.parse import parse_qs

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from django.utils import timezone
from PIL import Image

from addons.app_catalog.models import MetadataSnapshot, MobileApp
from addons.apple_store.google_play.client import SCOPE, GooglePlayClient, GooglePlayError
from addons.apple_store.google_play.serializers import TOKEN_URL
from addons.apple_store.google_play.services import AccountBusy, checked_client
from addons.apple_store.models import GooglePlayConnection, GooglePlayLease
from panda_store.core.access import activate_modules
from panda_store.core.credentials import decrypt
from panda_store.core.images import allowed_url
from panda_store.core.models import AIConnection, Membership, Workspace

PACKAGE = "com.example.running"
BASE = f"/androidpublisher/v3/applications/{PACKAGE}/edits"
EDIT = BASE + "/edit-one"


@pytest.fixture
def credentials():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return {
        "type": "service_account",
        "project_id": "panda-test",
        "private_key_id": "test-key",
        "private_key": key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode(),
        "client_email": "panda@panda-test.iam.gserviceaccount.com",
        "token_uri": TOKEN_URL,
    }


def payload(credentials, **overrides):
    return {
        "name": "Google developer",
        "package_name": PACKAGE,
        "dedicated_account": True,
        "service_account_json": json.dumps(credentials),
        **overrides,
    }


def url(workspace, suffix="connections/"):
    return f"/api/workspaces/{workspace.pk}/apple_store/google-play/{suffix}"


@pytest.fixture
def google_api(monkeypatch, credentials):
    routes = {
        ("POST", "/token"): {
            "access_token": "test-access-token",
            "token_type": "Bearer",
            "expires_in": 3600,
        },
        ("POST", BASE): {"id": "edit-one", "expiryTimeSeconds": "9999999999"},
        ("GET", EDIT + "/details"): {"defaultLanguage": "en-US"},
        ("GET", EDIT + "/listings"): {
            "listings": [
                {
                    "language": "fr-FR",
                    "title": "Courir",
                    "shortDescription": "Un journal de course",
                    "fullDescription": "Votre journal.",
                },
                {
                    "language": "en-US",
                    "title": "Running",
                    "shortDescription": "A running journal",
                    "fullDescription": "Plan your next run.",
                },
            ]
        },
        ("DELETE", EDIT): httpx.Response(204),
    }
    requests = []

    def handle(request):
        requests.append(request)
        if request.url.path == "/token":
            assert str(request.url) == TOKEN_URL
            form = parse_qs(request.content.decode())
            assert form["grant_type"] == ["urn:ietf:params:oauth:grant-type:jwt-bearer"]
            key = serialization.load_pem_private_key(credentials["private_key"].encode(), None)
            claims = jwt.decode(
                form["assertion"][0], key.public_key(), algorithms=["RS256"], audience=TOKEN_URL
            )
            assert claims["iss"] == credentials["client_email"]
            assert claims["scope"] == SCOPE and claims["exp"] - claims["iat"] <= 300
            assert "sub" not in claims
            assert "authorization" not in request.headers
        else:
            assert request.url.host == "androidpublisher.googleapis.com"
            assert request.headers["authorization"] == "Bearer test-access-token"
            assert ":commit" not in request.url.path
        response = routes.get((request.method, request.url.path))
        if response is None and request.method == "GET" and "/listings/en-US/" in request.url.path:
            kind = request.url.path.rsplit("/", 1)[-1]
            response = (
                {"images": [{"id": kind, "url": f"https://play-lh.googleusercontent.com/{kind}"}]}
                if kind in {"phoneScreenshots", "icon", "featureGraphic"}
                else {}
            )
        assert response is not None, (request.method, request.url)
        if callable(response):
            response = response()
        return (
            response if isinstance(response, httpx.Response) else httpx.Response(200, json=response)
        )

    client_class = httpx.Client
    monkeypatch.setattr(
        "addons.apple_store.google_play.client.httpx.Client",
        lambda **kwargs: client_class(**{**kwargs, "transport": httpx.MockTransport(handle)}),
    )
    return routes, requests


def connect(api, workspace, credentials):
    result = api.post(url(workspace), payload(credentials), format="json")
    assert result.status_code == 201, result.data
    return result.data


def test_connect_import_refresh_and_disconnect_preserve_data(
    api, workspace, credentials, google_api
):
    connection = connect(api, workspace, credentials)
    saved = GooglePlayConnection.objects.get(pk=connection["id"])
    assert json.loads(decrypt(saved.encrypted_credentials)) == credentials
    assert "private_key" not in str(connection) and "encrypted" not in str(connection)
    assert google_api[1][-1].method == "DELETE"
    assert not GooglePlayLease.objects.exists()
    imported = api.post(
        url(workspace, f"connections/{saved.pk}/import/"), {"package_name": PACKAGE}, format="json"
    )
    assert imported.status_code == 201, imported.data
    app = MobileApp.objects.get(pk=imported.data["id"])
    metadata = imported.data["metadata"]["data"]
    assert app.platform == "android" and app.sync_provider == "google_play"
    assert metadata["short_description"] == "A running journal" and metadata["subtitle"] == ""
    assert [item["locale"] for item in metadata["localizations"]] == ["en-US", "fr-FR"]
    assert metadata["screenshots_locale"] == "en-US" and len(metadata["screenshots"]) == 1
    assert metadata["feature_graphic_url"].endswith("/featureGraphic")
    sync = url(workspace, f"apps/{app.pk}/sync/")
    assert api.post(sync).status_code == 200
    assert app.snapshots.count() == 1
    google_api[0][("GET", EDIT + "/listings")]["listings"][1]["title"] = "Running updated"
    assert api.post(sync).status_code == 200
    assert app.snapshots.count() == 2
    listed = api.get(url(workspace, f"connections/{saved.pk}/apps/"))
    assert listed.data["apps"][0]["name"] == "Running updated"
    google_api[0][("GET", EDIT + "/details")] = httpx.Response(403, text="SECRET RAW PROVIDER DATA")
    failure = api.post(sync)
    assert failure.status_code == 502 and "SECRET" not in str(failure.data)
    assert google_api[1][-1].method == "DELETE"
    assert app.snapshots.count() == 2
    app.refresh_from_db()
    assert "denied access" in app.last_sync_error
    assert api.delete(url(workspace, f"connections/{saved.pk}/")).status_code == 204
    app.refresh_from_db()
    assert not app.sync_provider and app.snapshots.count() == 2
    assert not GooglePlayConnection.objects.exists()
    assert api.post(sync).status_code == 404


@pytest.mark.parametrize(
    "change",
    [
        {"type": "authorized_user"},
        {"token_uri": "https://attacker.test/token"},
        {"private_key": "invalid SECRET"},
        {"client_email": "not-a-service-account@example.com"},
        {"private_key_id": {}},
        {"project_id": []},
    ],
)
def test_rejects_bad_credentials_without_network(api, workspace, credentials, google_api, change):
    result = api.post(url(workspace), payload({**credentials, **change}), format="json")
    assert result.status_code == 400 and "SECRET" not in str(result.data)
    assert not google_api[1] and not GooglePlayConnection.objects.exists()


@pytest.mark.parametrize(
    "package", ["https://example.com", "com.app/../bad", "com.app?x=1", "app", "com."]
)
def test_invalid_package_does_not_contact_google(api, workspace, credentials, google_api, package):
    result = api.post(url(workspace), payload(credentials, package_name=package), format="json")
    assert result.status_code == 400 and not google_api[1]


def test_requires_dedicated_account_and_checks_play_access(api, workspace, credentials, google_api):
    assert (
        api.post(
            url(workspace), payload(credentials, dedicated_account=False), format="json"
        ).status_code
        == 400
    )
    assert not google_api[1]
    google_api[0][("POST", BASE)] = httpx.Response(403, text=credentials["private_key"])
    result = api.post(url(workspace), payload(credentials), format="json")
    assert result.status_code == 502 and "PRIVATE KEY" not in str(result.data)
    assert not GooglePlayConnection.objects.exists() and not GooglePlayLease.objects.exists()


def test_cleanup_failure_prevents_success_and_any_local_import(
    api, workspace, credentials, google_api
):
    connection = connect(api, workspace, credentials)
    google_api[0][("DELETE", EDIT)] = httpx.Response(500)
    result = api.post(
        url(workspace, f"connections/{connection['id']}/import/"),
        {"package_name": PACKAGE},
        format="json",
    )
    assert result.status_code == 502 and "could not be closed" in str(result.data)
    assert not MobileApp.objects.exists() and not MetadataSnapshot.objects.exists()
    assert not GooglePlayLease.objects.exists()


def test_malformed_listing_is_not_saved_and_edit_is_closed(api, workspace, credentials, google_api):
    google_api[0][("GET", EDIT + "/listings")] = {"listings": [{"language": "../bad"}]}
    result = api.post(url(workspace), payload(credentials), format="json")
    assert result.status_code == 502 and not GooglePlayConnection.objects.exists()
    assert google_api[1][-1].method == "DELETE"


def test_no_redirects_publish_or_unknown_image_hosts(credentials, google_api):
    google_api[0][("GET", EDIT + "/listings/en-US/icon")] = {
        "images": [{"url": "https://googleusercontent.com.attacker.test/secret"}]
    }
    with GooglePlayClient(credentials) as client:
        for method, path in [
            ("POST", f"{PACKAGE}/edits/edit-one:commit"),
            ("PUT", f"{PACKAGE}/edits/edit-one/listings/en-US"),
            ("GET", "https://attacker.test"),
        ]:
            with pytest.raises(GooglePlayError, match="Unsupported"):
                client.call(method, path)
        assert not google_api[1]
        assert client.get_metadata(PACKAGE)["icon_url"] == ""
    google_api[0][("POST", "/token")] = httpx.Response(
        302, headers={"Location": "https://attacker.test"}
    )
    count = len(google_api[1])
    with GooglePlayClient(credentials) as client, pytest.raises(GooglePlayError):
        client.get_metadata(PACKAGE)
    assert len(google_api[1]) == count + 1


def test_cleanup_keeps_a_separate_budget_after_import_timeout(credentials, google_api):
    with GooglePlayClient(credentials) as client:

        def expire():
            client.deadline = time.monotonic() - 1
            return {"defaultLanguage": "en-US"}

        google_api[0][("GET", EDIT + "/details")] = expire
        with pytest.raises(GooglePlayError, match="time limit"):
            client.get_metadata(PACKAGE)
    assert google_api[1][-1].method == "DELETE"


def test_account_lease_prevents_overlapping_edits_across_workspaces(db, credentials, google_api):
    with checked_client(credentials):
        with pytest.raises(AccountBusy), checked_client(credentials):
            pass
    assert not google_api[1] and not GooglePlayLease.objects.exists()
    GooglePlayLease.objects.create(
        client_email=credentials["client_email"],
        token=uuid.uuid4(),
        expires_at=timezone.now() - timedelta(seconds=1),
    )
    with checked_client(credentials) as client:
        client.get_metadata(PACKAGE, include_images=False)
    assert not GooglePlayLease.objects.exists()


def test_connection_revision_prevents_stale_import_and_key_replacement(
    api, workspace, credentials, google_api
):
    connection = connect(api, workspace, credentials)
    changed = uuid.uuid4()

    def replace():
        GooglePlayConnection.objects.filter(pk=connection["id"]).update(revision=changed)
        return httpx.Response(204)

    google_api[0][("DELETE", EDIT)] = replace
    result = api.post(
        url(workspace, f"connections/{connection['id']}/import/"),
        {"package_name": PACKAGE},
        format="json",
    )
    assert result.status_code == 409 and not MobileApp.objects.exists()
    count = len(google_api[1])
    result = api.put(
        url(workspace, f"connections/{connection['id']}/"),
        payload(credentials, revision=connection["revision"]),
        format="json",
    )
    assert result.status_code == 409 and len(google_api[1]) == count


def test_google_connections_enforce_roles_workspace_and_activation(
    api, workspace, credentials, google_api, owner
):
    connection = connect(api, workspace, credentials)
    detail = f"connections/{connection['id']}/"
    other = Workspace.objects.create(name="Other")
    Membership.objects.create(workspace=other, user=owner, role="owner")
    activate_modules(other, ["apple_store"])
    assert api.get(url(other, detail + "apps/")).status_code == 404
    assert api.delete(url(other, detail)).status_code == 404
    Membership.objects.filter(workspace=workspace).update(role="viewer")
    assert api.get(url(workspace)).status_code == 200
    assert api.post(url(workspace), payload(credentials), format="json").status_code == 403
    assert (
        api.post(
            url(workspace, detail + "import/"), {"package_name": PACKAGE}, format="json"
        ).status_code
        == 403
    )
    assert api.delete(url(workspace, detail)).status_code == 403
    Membership.objects.filter(workspace=workspace).update(role="editor")
    assert (
        api.post(
            url(workspace, detail + "import/"), {"package_name": PACKAGE}, format="json"
        ).status_code
        == 201
    )
    workspace.modules.filter(module_id="apple_store").delete()
    assert api.get(url(workspace)).status_code == 403


def test_android_short_description_reaches_smm_context(api, workspace, credentials, google_api):
    from addons.studio.models import SocialResearch
    from panda_store.core.credentials import encrypt

    connection = connect(api, workspace, credentials)
    imported = api.post(
        url(workspace, f"connections/{connection['id']}/import/"),
        {"package_name": PACKAGE},
        format="json",
    ).data
    AIConnection.objects.create(
        workspace=workspace,
        provider="openai",
        encrypted_key=encrypt("test"),
        model_catalog=[{"id": "gpt-4.1-mini"}],
    )
    response = api.post(
        f"/api/workspaces/{workspace.pk}/studio/apps/{imported['id']}/social-research/",
        {
            "request_id": str(uuid.uuid4()),
            "snapshot_id": imported["metadata"]["id"],
            "topic": "Running apps",
            "market": "en-US",
            "platforms": ["tiktok"],
            "min_views": 10000,
            "min_likes": 500,
            "provider": "openai",
            "model": "gpt-4.1-mini",
            "facts_confirmed": True,
            "brief": {
                "audience": "Runners",
                "goal": "Try the app",
                "tone": "Clear",
                "product_facts": "The app helps plan a run.",
                "language": "English",
                "duration_seconds": 30,
            },
        },
        format="json",
    )
    assert response.status_code == 202, response.data
    metadata = SocialResearch.objects.get(pk=response.data["id"]).inputs["metadata"]
    assert (
        metadata["platform"] == "android" and metadata["short_description"] == "A running journal"
    )


def test_google_screenshots_can_be_archived_for_smm(api, workspace, credentials, google_api):
    connection = connect(api, workspace, credentials)
    imported = api.post(
        url(workspace, f"connections/{connection['id']}/import/"),
        {"package_name": PACKAGE},
        format="json",
    ).data
    endpoint = f"/api/workspaces/{workspace.pk}/studio/apps/{imported['id']}/scene-assets/"
    candidates = api.get(endpoint).data["candidates"]
    assert len(candidates) == 1
    picture = io.BytesIO()
    Image.new("RGB", (100, 200), "blue").save(picture, format="PNG")

    def serve(request):
        assert request.url.host == "play-lh.googleusercontent.com"
        assert "authorization" not in request.headers
        return httpx.Response(200, content=picture.getvalue())

    client = httpx.AsyncClient(transport=httpx.MockTransport(serve))
    with patch("panda_store.core.images.httpx.AsyncClient", return_value=client):
        saved = api.post(
            endpoint,
            {
                "snapshot_id": candidates[0]["snapshot_id"],
                "position": candidates[0]["position"],
            },
            format="json",
        )
    assert saved.status_code == 201, saved.data
    assert saved.data["kind"] == "store_screenshot"
    assert api.get(saved.data["url"]).content.startswith(b"\xff\xd8")


@pytest.mark.parametrize(
    "address,allowed",
    [
        ("https://play-lh.googleusercontent.com/a", True),
        ("https://lh3.googleusercontent.com/a", True),
        ("https://lh5.ggpht.com/a", True),
        ("http://play-lh.googleusercontent.com/a", False),
        ("https://play-lh.googleusercontent.com.evil.test/a", False),
        ("https://user@play-lh.googleusercontent.com/a", False),
        ("https://play-lh.googleusercontent.com:9000/a", False),
        ("https://other.googleusercontent.com/a", False),
        ("https://is1-ssl.mzstatic.com/a", False),
    ],
)
def test_google_image_hosts_remain_restricted(address, allowed):
    assert allowed_url(address, store="google_play") is allowed
