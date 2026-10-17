import json
import uuid
from copy import deepcopy
from unittest.mock import patch

import httpx
import jwt
import pytest
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from addons.app_catalog.models import MetadataSnapshot, MobileApp
from addons.apple_store.client import AppleClient, AppleError, image_url
from addons.apple_store.models import AppleAppBinding, AppleConnection
from panda_store.core.access import activate_modules
from panda_store.core.credentials import CredentialsUnavailable, decrypt, encrypt
from panda_store.core.models import Membership, Workspace
from scripts.bootstrap import main as bootstrap


@pytest.fixture
def key():
    return ec.generate_private_key(ec.SECP256R1())


@pytest.fixture
def credentials(key):
    return {
        "name": "Example developer",
        "key_type": "team",
        "key_id": "ABCDEFGHIJ",
        "issuer_id": str(uuid.uuid4()),
        "private_key": key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode(),
    }


def resource(id, **attributes):
    return {"id": id, "attributes": attributes}


def test_import_tracks_missing_localized_fields_without_auditing_fallback_names(
    apple_api, credentials
):
    from addons.aso.rules import localized_metadata

    routes = apple_api[0]
    del routes["/v1/appInfos/info-live/appInfoLocalizations"]["data"][1]["attributes"]["name"]
    routes["/v1/appStoreVersions/live/appStoreVersionLocalizations"]["data"][0]["attributes"][
        "promotionalText"
    ] = None
    with AppleClient(
        **{key: value for key, value in credentials.items() if key != "name"}
    ) as client:
        metadata = client.get_metadata("123")
    french = localized_metadata(metadata, "fr-FR")
    english = localized_metadata(metadata, "en-US")
    assert "name" not in french  # Display fallback must not become localized audit evidence.
    assert french["description"] == "Votre journal de course."
    assert english["promotional_text"] == ""  # Explicitly unset differs from not imported.
    assert "promotional_text" not in french


@pytest.fixture
def apple_api(monkeypatch):
    app = resource("123", name="Running", bundleId="org.example.running", primaryLocale="en-US")
    app["relationships"] = {"appStoreIcon": {"data": {"id": "icon", "type": "buildIcons"}}}
    info = resource("info-live", state="READY_FOR_DISTRIBUTION")
    info["relationships"] = {"primaryCategory": {"data": {"id": "HEALTH_AND_FITNESS"}}}
    routes = {
        "/v1/apps": {"data": [app]},
        "/v1/apps/123": {
            "data": app,
            "included": [
                {
                    "id": "icon",
                    "type": "buildIcons",
                    "attributes": {
                        "iconAsset": {
                            "templateUrl": "https://is1-ssl.mzstatic.com/image/{w}x{h}.{f}",
                            "width": 1024,
                            "height": 1024,
                        }
                    },
                }
            ],
        },
        "/v1/apps/123/appStoreVersions": {
            "data": [
                resource(
                    "draft",
                    versionString="2.0",
                    appVersionState="PREPARE_FOR_SUBMISSION",
                    createdDate="2026-10-15",
                ),
                resource(
                    "live",
                    versionString="1.0",
                    appVersionState="READY_FOR_DISTRIBUTION",
                    createdDate="2026-10-01",
                ),
            ]
        },
        "/v1/apps/123/appInfos": {
            "data": [resource("info-draft", state="PREPARE_FOR_SUBMISSION"), info]
        },
        "/v1/appInfos/info-live/appInfoLocalizations": {
            "data": [
                resource("name-en", locale="en-US", name="Running", subtitle="Go running"),
                resource("name-fr", locale="fr-FR", name="Courir", subtitle="Allez courir"),
            ]
        },
        "/v1/appStoreVersions/live/appStoreVersionLocalizations": {
            "data": [
                resource(
                    "text-en",
                    locale="en-US",
                    description="Your running journal.",
                    keywords="running,journal",
                ),
                resource(
                    "text-fr",
                    locale="fr-FR",
                    description="Votre journal de course.",
                    keywords="course,journal",
                ),
            ]
        },
        "/v1/appStoreVersionLocalizations/text-en/appScreenshotSets": {
            "data": [resource("set-phone", screenshotDisplayType="APP_IPHONE_67")]
        },
        "/v1/appScreenshotSets/set-phone/appScreenshots": {
            "data": [
                resource(
                    "shot",
                    fileName="Home.png",
                    imageAsset={
                        "templateUrl": "https://is1-ssl.mzstatic.com/screen/{w}x{h}.{f}",
                        "width": 1200,
                        "height": 2400,
                    },
                )
            ]
        },
    }
    requests = []

    def handle(request):
        requests.append(request)
        assert request.method == "GET"
        assert request.url.host == "api.appstoreconnect.apple.com"
        response = routes[request.url.path]
        # Apple omits category linkage unless the relationship is explicitly included.
        if request.url.path.endswith("/appInfos") and not isinstance(response, httpx.Response):
            response = deepcopy(response)
            if "primaryCategory" not in request.url.params.get("include", "").split(","):
                for item in response["data"]:
                    item.get("relationships", {}).get("primaryCategory", {}).pop("data", None)
        return (
            response if isinstance(response, httpx.Response) else httpx.Response(200, json=response)
        )

    client_class = httpx.Client
    monkeypatch.setattr(
        "addons.apple_store.client.httpx.Client",
        lambda **kwargs: client_class(**{**kwargs, "transport": httpx.MockTransport(handle)}),
    )
    return routes, requests


def url(workspace, suffix="connections/"):
    return f"/api/workspaces/{workspace.pk}/apple_store/{suffix}"


def connect(api, workspace, credentials):
    response = api.post(url(workspace), credentials, format="json")
    assert response.status_code == 201, response.data
    return response.data


def test_connection_import_sync_and_disconnect(
    api, workspace, credentials, key, apple_api, settings
):
    settings.PANDA_DEMO_MODE = False
    connection = connect(api, workspace, credentials)
    record = AppleConnection.objects.get()
    assert record.encrypted_private_key != credentials["private_key"]
    assert decrypt(record.encrypted_private_key) == credentials["private_key"]
    assert "private_key" not in json.dumps(connection)
    assert "encrypted_private_key" not in str(api.get(url(workspace)).data)
    payload = jwt.decode(
        apple_api[1][0].headers["authorization"].split()[1],
        key.public_key(),
        algorithms=["ES256"],
        audience="appstoreconnect-v1",
    )
    assert payload["iss"] == credentials["issuer_id"]
    assert "sub" not in payload
    assert payload["exp"] - payload["iat"] == 120
    assert payload["scope"][0].startswith("GET /v1/apps?")
    base = f"connections/{connection['id']}/"
    assert api.get(url(workspace, base + "apps/")).data["apps"][0]["name"] == "Running"
    response = api.post(url(workspace, base + "import/"), {"external_id": "123"})
    assert response.status_code == 201, response.data
    app = MobileApp.objects.get()
    data = response.data["metadata"]["data"]
    assert data["version"] == "1.0" and data["subtitle"] == "Go running"
    assert data["category_id"] == "HEALTH_AND_FITNESS"
    assert data["category"] == "Health And Fitness"
    assert data["localizations"][1]["description"] == "Votre journal de course."
    assert data["icon_url"].endswith("256x256.png")
    assert data["screenshots"][0]["url"].endswith("450x900.png")
    assert response.data["last_synced_at"] and not response.data["is_demo"]
    sync_url = url(workspace, f"apps/{app.pk}/sync/")
    assert api.post(sync_url).status_code == 200
    assert MetadataSnapshot.objects.count() == 1
    apple_api[0]["/v1/appStoreVersions/live/appStoreVersionLocalizations"]["data"][0]["attributes"][
        "description"
    ] = "Updated journal."
    assert api.post(sync_url).status_code == 200
    assert MetadataSnapshot.objects.count() == 2
    apple_api[0]["/v1/apps/123"] = httpx.Response(429, json={"secret": credentials["private_key"]})
    failed = api.post(sync_url)
    assert failed.status_code == 502
    assert credentials["private_key"] not in str(failed.data)
    assert app.snapshots.first().data["description"] == "Updated journal."
    app.refresh_from_db()
    assert "request limit" in app.last_sync_error
    assert api.delete(url(workspace, base)).status_code == 204
    app.refresh_from_db()
    assert not app.sync_provider
    assert MetadataSnapshot.objects.count() == 2 and not AppleConnection.objects.exists()
    assert api.post(sync_url).status_code == 404


def test_workspace_credentials_are_independent(api, owner, workspace, credentials, key, apple_api):
    first = connect(api, workspace, credentials)
    other = Workspace.objects.create(name="Second organization")
    Membership.objects.create(user=owner, workspace=other, role="owner")
    activate_modules(other, ["apple_store"])
    individual = {**credentials, "key_type": "individual", "issuer_id": None}
    second = connect(api, other, individual)
    token = apple_api[1][-1].headers["authorization"].split()[1]
    claims = jwt.decode(
        token, key.public_key(), algorithms=["ES256"], audience="appstoreconnect-v1"
    )
    assert claims["sub"] == "user" and "iss" not in claims
    assert first["id"] != second["id"]
    for method, suffix, data in [
        ("get", "apps/", None),
        ("post", "import/", {"external_id": "123"}),
        ("delete", "", None),
        ("put", "", credentials),
    ]:
        assert (
            getattr(api, method)(
                url(other, f"connections/{first['id']}/{suffix}"), data, format="json"
            ).status_code
            == 404
        )
    for space, item in [(workspace, first), (other, second)]:
        assert (
            api.post(
                url(space, f"connections/{item['id']}/import/"), {"external_id": "123"}
            ).status_code
            == 201
        )
    assert MobileApp.objects.count() == 2
    assert api.get(url(workspace)).data["connections"][0]["key_type"] == "team"


@pytest.mark.parametrize("role", ["editor", "viewer"])
def test_connection_roles(api, workspace, credentials, apple_api, role):
    connection = connect(api, workspace, credentials)
    Membership.objects.filter(workspace=workspace).update(role=role)
    base = f"connections/{connection['id']}/"
    assert api.get(url(workspace)).status_code == 200
    assert api.post(url(workspace), credentials, format="json").status_code == 403
    assert api.put(url(workspace, base), credentials, format="json").status_code == 403
    assert api.delete(url(workspace, base)).status_code == 403
    response = api.post(url(workspace, base + "import/"), {"external_id": "123"})
    assert response.status_code == (201 if role == "editor" else 403)
    assert api.post(url(workspace, f"apps/{uuid.uuid4()}/sync/")).status_code == (
        404 if role == "editor" else 403
    )


def test_failed_replace_preserves_key(api, workspace, credentials, apple_api):
    connection = connect(api, workspace, credentials)
    original = AppleConnection.objects.get().encrypted_private_key
    apple_api[0]["/v1/apps"] = httpx.Response(401, text="private upstream details")
    response = api.put(
        url(workspace, f"connections/{connection['id']}/"),
        {**credentials, "key_id": "KLMNOPQRST"},
        format="json",
    )
    assert response.status_code == 502
    record = AppleConnection.objects.get()
    assert record.encrypted_private_key == original and record.key_id == "ABCDEFGHIJ"
    assert "private upstream" not in str(response.data)


@pytest.mark.parametrize(
    "change",
    [
        {"private_key": "not a key"},
        {"issuer_id": None},
        {"key_type": "individual"},
        {"key_id": "bad"},
    ],
)
def test_bad_credentials_rejected_before_network(api, workspace, credentials, apple_api, change):
    response = api.post(url(workspace), {**credentials, **change}, format="json")
    assert response.status_code == 400
    assert not apple_api[1] and not AppleConnection.objects.exists()


def test_missing_encryption_key_fails_closed(api, workspace, credentials, apple_api, settings):
    settings.PANDA_CREDENTIAL_KEYS = ()
    assert api.get(url(workspace)).data["credentials_ready"] is False
    assert api.post(url(workspace), credentials, format="json").status_code == 503
    assert not apple_api[1] and not AppleConnection.objects.exists()


def test_encryption_rotation(settings):
    old = Fernet.generate_key().decode()
    new = Fernet.generate_key().decode()
    settings.PANDA_CREDENTIAL_KEYS = (old,)
    ciphertext = encrypt("private test credential")
    settings.PANDA_CREDENTIAL_KEYS = (new, old)
    assert decrypt(ciphertext) == "private test credential"
    new_ciphertext = encrypt("replacement credential")
    settings.PANDA_CREDENTIAL_KEYS = (new,)
    assert decrypt(new_ciphertext) == "replacement credential"
    with pytest.raises(CredentialsUnavailable):
        decrypt(ciphertext)


@pytest.mark.parametrize("mutation", ["delete", "replace"])
def test_inflight_import_cannot_restore_disconnected_credentials(
    api, workspace, credentials, apple_api, mutation
):
    connection = connect(api, workspace, credentials)
    original = AppleClient.get_metadata

    def changed(client, external_id):
        metadata = original(client, external_id)
        if mutation == "delete":
            AppleConnection.objects.all().delete()
        else:
            AppleConnection.objects.all().update(revision=uuid.uuid4())
        return metadata

    with patch.object(AppleClient, "get_metadata", changed):
        response = api.post(
            url(workspace, f"connections/{connection['id']}/import/"), {"external_id": "123"}
        )
    assert response.status_code == 409
    assert not MobileApp.objects.exists() and not AppleAppBinding.objects.exists()


def test_pagination_and_token_scope(credentials, key):
    calls = []

    def handle(request):
        calls.append(request)
        claims = jwt.decode(
            request.headers["authorization"].split()[1],
            key.public_key(),
            algorithms=["ES256"],
            audience="appstoreconnect-v1",
        )
        assert claims["scope"] == ["GET " + request.url.raw_path.decode()]
        if request.url.params.get("cursor"):
            return httpx.Response(200, json={"data": [resource("2")]})
        return httpx.Response(
            200,
            json={
                "data": [resource("1")],
                "links": {
                    "next": "https://api.appstoreconnect.apple.com/v1/apps?cursor=next&limit=200"
                },
            },
        )

    with AppleClient(
        **{k: v for k, v in credentials.items() if k != "name"},
        transport=httpx.MockTransport(handle),
    ) as client:
        assert [item["id"] for item in client.all("/v1/apps")] == ["1", "2"]
    assert len(calls) == 2


@pytest.mark.parametrize(
    "next_url",
    [
        "https://evil.example/v1/apps?cursor=x",
        "http://api.appstoreconnect.apple.com/v1/apps?cursor=x",
        "https://api.appstoreconnect.apple.com/v1/other?cursor=x",
        "https://api.appstoreconnect.apple.com/v1/apps",
    ],
)
def test_untrusted_pagination_is_rejected(credentials, next_url):
    with AppleClient(**{k: v for k, v in credentials.items() if k != "name"}) as client:
        with pytest.raises(AppleError):
            client.next_cursor({"links": {"next": next_url}}, "/v1/apps")


@pytest.mark.parametrize("status", [301, 401, 403, 404, 429, 500])
def test_apple_errors_do_not_forward_or_leak(credentials, status):
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(
            status, headers={"Location": "https://evil.example"}, text="secret upstream body"
        )

    with AppleClient(
        **{k: v for k, v in credentials.items() if k != "name"},
        transport=httpx.MockTransport(handle),
    ) as client:
        with pytest.raises(AppleError) as error:
            client.list_apps()
    assert "secret upstream" not in str(error.value) and len(calls) == 1


def test_no_ios_version_or_failed_asset_import_creates_no_snapshot(
    api, workspace, credentials, apple_api
):
    connection = connect(api, workspace, credentials)
    base = url(workspace, f"connections/{connection['id']}/import/")
    apple_api[0]["/v1/appScreenshotSets/set-phone/appScreenshots"] = httpx.Response(503)
    assert api.post(base, {"external_id": "123"}).status_code == 502
    assert not MetadataSnapshot.objects.exists()
    apple_api[0]["/v1/apps/123/appStoreVersions"] = {"data": []}
    assert api.post(base, {"external_id": "123"}).status_code == 502
    assert not MobileApp.objects.exists()


def test_image_assets_reject_untrusted_urls():
    assert image_url({"templateUrl": "http://localhost/secret"}) == ""
    assert image_url({"templateUrl": "https://mzstatic.com.evil.example/a"}) == ""


def test_fresh_install_generates_unique_encryption_keys(tmp_path):
    values = []
    for name in ["one", "two"]:
        root = tmp_path / name
        root.mkdir()
        (root / ".env.example").write_text("DJANGO_SECRET_KEY=\nPANDA_CREDENTIAL_KEYS=\n")
        bootstrap(root)
        contents = (root / ".env").read_text()
        value = contents.split("PANDA_CREDENTIAL_KEYS=")[1].strip()
        Fernet(value)
        values.append(value)
        bootstrap(root)
        assert (root / ".env").read_text() == contents
        assert (root / ".env").stat().st_mode & 0o777 == 0o600
    assert values[0] != values[1]


def test_upgrade_adds_only_missing_encryption_key(tmp_path):
    (tmp_path / ".env.example").write_text("PANDA_CREDENTIAL_KEYS=\n")
    env = tmp_path / ".env"
    env.write_text("DJANGO_SECRET_KEY=existing-test-key\nCUSTOM=value")
    bootstrap(tmp_path, add_credential_key=True)
    first = env.read_text()
    assert first.startswith("DJANGO_SECRET_KEY=existing-test-key\nCUSTOM=value\n")
    Fernet(first.split("PANDA_CREDENTIAL_KEYS=")[1].strip())
    bootstrap(tmp_path, add_credential_key=True)
    assert env.read_text() == first


def test_network_timeout_and_page_cycle_are_bounded(credentials):
    def timeout(request):
        raise httpx.ReadTimeout("private upstream detail", request=request)

    values = {k: v for k, v in credentials.items() if k != "name"}
    with AppleClient(**values, transport=httpx.MockTransport(timeout)) as client:
        with pytest.raises(AppleError) as error:
            client.list_apps()
        assert "private upstream" not in str(error.value)

    def cycle(request):
        return httpx.Response(
            200,
            json={
                "data": [],
                "links": {"next": "https://api.appstoreconnect.apple.com/v1/apps?cursor=repeat"},
            },
        )

    with AppleClient(**values, transport=httpx.MockTransport(cycle)) as client:
        with pytest.raises(AppleError, match="repeated"):
            client.all("/v1/apps")
        assert client.requests == 2
