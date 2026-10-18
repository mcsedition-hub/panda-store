"""Import deployed Play listings via a temporary edit; never commit an edit.

https://developers.google.com/android-publisher/edits
https://developers.google.com/android-publisher/api-ref/rest/v3/edits.listings
https://developers.google.com/identity/protocols/oauth2/service-account
"""

import json
import re
import time
from functools import wraps

import httpx
import jwt
from rest_framework.exceptions import APIException

from panda_store.core.images import allowed_url

from .serializers import PACKAGE_PATTERN, TOKEN_URL

API_ROOT = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/"
SCOPE = "https://www.googleapis.com/auth/androidpublisher"
SCREENSHOT_TYPES = (
    "phoneScreenshots",
    "sevenInchScreenshots",
    "tenInchScreenshots",
    "tvScreenshots",
    "wearScreenshots",
)
IMAGE_TYPES = (*SCREENSHOT_TYPES, "icon", "featureGraphic")


class GooglePlayError(APIException):
    status_code = 502
    default_detail = "Google Play could not complete the import. Try again later."


def checked_response(method):
    @wraps(method)
    def wrapped(*args, **kwargs):
        try:
            return method(*args, **kwargs)
        except (ValueError, TypeError, KeyError, AttributeError, StopIteration):
            raise GooglePlayError(
                "Google Play returned an incomplete or unreadable listing."
            ) from None

    return wrapped


def image_url(value):
    if not isinstance(value, str) or len(value) > 4096:
        return ""
    return value if allowed_url(value, store="google_play") else ""


class GooglePlayClient:
    def __init__(self, credentials, *, transport=None):
        self.credentials = credentials
        self.http = httpx.Client(transport=transport, follow_redirects=False, timeout=8)
        self.deadline = time.monotonic() + 40
        self.requests = 0
        self.access_token = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.http.close()

    def exchange(self, method, url, *, cleanup=False, **kwargs):
        self.requests += 1
        deadline = time.monotonic() + 5 if cleanup else self.deadline
        if (not cleanup and self.requests > 20) or time.monotonic() >= deadline:
            raise GooglePlayError("The Google Play import reached its request or time limit.")
        try:
            with self.http.stream(
                method, url, timeout=min(8, max(0.1, deadline - time.monotonic())), **kwargs
            ) as response:
                if cleanup and response.status_code in {204, 404}:
                    return {}
                if not 200 <= response.status_code < 300:
                    errors = {
                        400: "Google rejected this request. Check the key and package name. "
                        "The app must already have an uploaded build in Play Console.",
                        401: "Google rejected this service account key. Replace it in Connections.",
                        403: "Google Play denied access. Enable the Android Publisher API and "
                        "invite "
                        "this service account to the app in Play Console with listing access.",
                        404: "Google Play could not find this app or edit. Check the package name "
                        "and account access, then retry.",
                        409: "The Google Play edit changed during import. "
                        "Retry when other edits finish.",
                        429: "Google Play's request limit was reached. Try again later.",
                    }
                    raise GooglePlayError(
                        errors.get(response.status_code, GooglePlayError.default_detail)
                    )
                body = bytearray()
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > 4_194_304 or time.monotonic() >= deadline:
                        raise GooglePlayError("Google Play's response exceeded the import limit.")
                if cleanup and not body:
                    return {}
                data = json.loads(body)
                if not isinstance(data, dict):
                    raise ValueError()
                return data
        except (httpx.HTTPError, ValueError, TypeError):
            raise GooglePlayError() from None

    def authorize(self):
        now = int(time.time())
        assertion = jwt.encode(
            {
                "iss": self.credentials["client_email"],
                "scope": SCOPE,
                "aud": TOKEN_URL,
                "iat": now,
                "exp": now + 300,
            },
            self.credentials["private_key"],
            algorithm="RS256",
            headers={"kid": self.credentials["private_key_id"], "typ": "JWT"},
        )
        data = self.exchange(
            "POST",
            TOKEN_URL,
            data={
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "assertion": assertion,
            },
        )
        token = data.get("access_token")
        if not isinstance(token, str) or not token or len(token) > 8192:
            raise GooglePlayError(
                "Google did not return an access token. Check this service account."
            )
        self.access_token = token

    def call(self, method, path, *, cleanup=False):
        # A narrow allowlist prevents an accidental publish/update or credential redirect.
        base = rf"{PACKAGE_PATTERN}/edits"
        edit = base + r"/[A-Za-z0-9_-]{1,200}"
        read = (
            edit
            + r"/(?:details|listings(?:/[A-Za-z0-9-]{1,50}/(?:"
            + "|".join(IMAGE_TYPES)
            + r"))?)"
        )
        pattern = {"POST": base, "GET": read, "DELETE": edit}.get(method)
        if not pattern or not re.fullmatch(pattern, path):
            raise GooglePlayError("Unsupported Google Play operation.")
        if self.access_token is None:
            self.authorize()
        kwargs = {"headers": {"Authorization": f"Bearer {self.access_token}"}}
        if method == "POST":
            kwargs["json"] = {}
        return self.exchange(method, API_ROOT + path, cleanup=cleanup, **kwargs)

    @checked_response
    def get_metadata(self, package_name, *, include_images=True):
        if not re.fullmatch(PACKAGE_PATTERN, package_name) or len(package_name) > 200:
            raise GooglePlayError("Enter the app's package name, for example com.example.app.")
        edit = self.call("POST", f"{package_name}/edits")
        edit_id = edit.get("id")
        if not isinstance(edit_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,200}", edit_id):
            raise GooglePlayError("Google Play did not return a valid temporary edit.")
        path = f"{package_name}/edits/{edit_id}"
        try:
            return self.read_metadata(package_name, path, include_images)
        finally:
            try:
                self.call("DELETE", path, cleanup=True)
            except GooglePlayError:
                raise GooglePlayError(
                    "The temporary Google Play edit could not be closed. Nothing was published "
                    "or saved locally. Wait for the edit to expire before retrying."
                ) from None

    def read_metadata(self, package_name, path, include_images):
        details = self.call("GET", path + "/details")
        primary = details["defaultLanguage"]
        raw = self.call("GET", path + "/listings").get("listings", [])
        if not isinstance(raw, list) or not raw or len(raw) > 200:
            raise GooglePlayError(
                "Create a store listing in Play Console before importing this app."
            )
        localizations = []
        for listing in raw:
            locale = listing["language"]
            if not isinstance(locale, str) or not re.fullmatch(r"[A-Za-z0-9-]{1,50}", locale):
                raise ValueError()
            fields = {
                "name": "title",
                "short_description": "shortDescription",
                "description": "fullDescription",
                "video_url": "video",
            }
            text = {name: listing.get(field) or "" for name, field in fields.items()}
            if any(not isinstance(value, str) for value in text.values()):
                raise ValueError()
            localizations.append(
                {
                    "locale": locale,
                    **text,
                    "available_fields": [
                        name for name, field in fields.items() if field in listing
                    ],
                }
            )
        localizations.sort(key=lambda item: item["locale"])
        if len({item["locale"] for item in localizations}) != len(localizations):
            raise ValueError()
        text = next(item for item in localizations if item["locale"] == primary)
        if not text["name"]:
            raise ValueError()
        assets = {}
        if include_images:
            for kind in IMAGE_TYPES:
                images = self.call("GET", f"{path}/listings/{primary}/{kind}").get("images", [])
                if not isinstance(images, list) or len(images) > 50:
                    raise ValueError()
                assets[kind] = [
                    {"url": url, "name": f"{kind} {index + 1}", "display_type": kind}
                    for index, item in enumerate(images)
                    if (url := image_url(item.get("url")))
                ]
        return {
            **text,
            "external_id": package_name,
            "bundle_id": package_name,
            "platform": "android",
            "localizations": localizations,
            "subtitle": "",
            "category": "",
            "version": "",
            "icon_url": next(iter(assets.get("icon", [])), {}).get("url", ""),
            "feature_graphic_url": next(iter(assets.get("featureGraphic", [])), {}).get("url", ""),
            "screenshots": [shot for kind in SCREENSHOT_TYPES for shot in assets.get(kind, [])],
            "screenshots_locale": primary,
            "features": [],
            "audience": "",
            "source_note": "Imported from the Google Play deployed listing. Images are previews "
            "in the default language. Category and release version are not imported.",
        }
