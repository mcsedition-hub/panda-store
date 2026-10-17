"""Read-only App Store Connect client. Credentials never leave Apple's API host."""

import json
import re
import time
from functools import wraps
from urllib.parse import parse_qs, urlsplit

import httpx
import jwt
from rest_framework.exceptions import APIException

from panda_store.core.credentials import decrypt

API_ROOT = "https://api.appstoreconnect.apple.com"
LIVE_STATES = {"READY_FOR_DISTRIBUTION", "READY_FOR_SALE", "PREORDER_READY_FOR_SALE"}


class AppleError(APIException):
    status_code = 502
    default_detail = "Apple could not complete the request. Try again."


def checked_response(method):
    @wraps(method)
    def wrapped(*args, **kwargs):
        try:
            return method(*args, **kwargs)
        except (KeyError, TypeError, ValueError, AttributeError):
            raise AppleError("Apple returned an unreadable response. Try again.") from None

    return wrapped


def resource_id(value):
    value = str(value)
    if not re.fullmatch(r"[A-Za-z0-9-]{1,200}", value):
        raise AppleError("Apple returned an invalid resource ID.")
    return value


def image_url(asset, size=600):
    template = (asset or {}).get("templateUrl", "")
    parsed = urlsplit(template)
    if parsed.scheme != "https" or not (parsed.hostname or "").endswith(".mzstatic.com"):
        return ""
    width, height = asset.get("width") or size, asset.get("height") or size
    scale = min(1, size / max(width, height))
    return (
        template.replace("{w}", str(max(1, round(width * scale))))
        .replace("{h}", str(max(1, round(height * scale))))
        .replace("{f}", "png")
    )


def state(resource):
    attributes = resource.get("attributes", {})
    return (
        attributes.get("appVersionState")
        or attributes.get("state")
        or attributes.get("appStoreState", "")
    )


class AppleClient:
    def __init__(self, *, key_id, key_type, issuer_id, private_key, transport=None):
        self.key_id, self.key_type = key_id, key_type
        self.issuer_id, self.private_key = issuer_id, private_key
        self.http = httpx.Client(transport=transport, follow_redirects=False, timeout=8)
        self.deadline = time.monotonic() + 20
        self.requests = 0

    @classmethod
    def from_connection(cls, connection):
        return cls(
            key_id=connection.key_id,
            key_type=connection.key_type,
            issuer_id=connection.issuer_id,
            private_key=decrypt(connection.encrypted_private_key),
        )

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.http.close()

    def token(self, url):
        now = int(time.time())
        parsed = urlsplit(url)
        scope = parsed.path + (f"?{parsed.query}" if parsed.query else "")
        claims = {
            "iat": now,
            "exp": now + 120,
            "aud": "appstoreconnect-v1",
            "scope": [f"GET {scope}"],
        }
        claims.update({"iss": self.issuer_id} if self.key_type == "team" else {"sub": "user"})
        return jwt.encode(
            claims, self.private_key, algorithm="ES256", headers={"kid": self.key_id, "typ": "JWT"}
        )

    def get(self, path, params=None):
        url = str(httpx.URL(API_ROOT + path, params=params))
        self.requests += 1
        if self.requests > 60 or time.monotonic() >= self.deadline:
            raise AppleError("This Apple import exceeded the request limit. Try again later.")
        try:
            with self.http.stream(
                "GET",
                url,
                headers={"Authorization": f"Bearer {self.token(url)}"},
                timeout=min(8, max(0.1, self.deadline - time.monotonic())),
            ) as response:
                errors = {
                    401: "Apple rejected this API key. Check the Key ID, key type and Issuer ID.",
                    403: "This key cannot read app details. Check its permissions in Apple.",
                    404: "This app or resource is no longer available to this Apple account.",
                    429: "Apple's request limit was reached. Try again later.",
                }
                if response.status_code != 200:
                    raise AppleError(errors.get(response.status_code, AppleError.default_detail))
                body = bytearray()
                for chunk in response.iter_bytes():
                    body.extend(chunk)
                    if len(body) > 4_194_304 or time.monotonic() >= self.deadline:
                        raise AppleError(
                            "Apple's response exceeded the import limit. Try again later."
                        )
                data = json.loads(body)
                if not isinstance(data, dict) or "data" not in data:
                    raise AppleError()
                return data
        except (httpx.HTTPError, ValueError, TypeError):
            raise AppleError() from None

    def next_cursor(self, response, path):
        next_url = response.get("links", {}).get("next")
        if not next_url:
            return None
        parsed = urlsplit(next_url)
        if (
            parsed.scheme != "https"
            or parsed.netloc != "api.appstoreconnect.apple.com"
            or parsed.path != path
            or parsed.fragment
        ):
            raise AppleError("Apple returned an invalid pagination link.")
        cursor = parse_qs(parsed.query).get("cursor", [None])[0]
        if not cursor or len(cursor) > 4096:
            raise AppleError("Apple returned an invalid pagination cursor.")
        return cursor

    def all(self, path, params=None):
        params = {"limit": 200, **(params or {})}
        items, seen = [], set()
        while True:
            response = self.get(path, params)
            if not isinstance(response["data"], list):
                raise AppleError()
            items.extend(response["data"])
            cursor = self.next_cursor(response, path)
            if cursor is None:
                return items
            if cursor in seen:
                raise AppleError("Apple repeated a pagination cursor. Try again later.")
            seen.add(cursor)
            params["cursor"] = cursor

    @checked_response
    def list_apps(self, cursor=None):
        params = {"limit": 100, "sort": "name"}
        if cursor:
            params["cursor"] = cursor
        response = self.get("/v1/apps", params)
        return {
            "apps": [
                {
                    "external_id": item["id"],
                    "name": item["attributes"]["name"],
                    "bundle_id": item["attributes"].get("bundleId", ""),
                    "locale": item["attributes"].get("primaryLocale", ""),
                }
                for item in response["data"]
            ],
            "next_cursor": self.next_cursor(response, "/v1/apps"),
        }

    @checked_response
    def get_metadata(self, external_id):
        app_path = f"/v1/apps/{resource_id(external_id)}"
        response = self.get(app_path, {"include": "appStoreIcon"})
        app = response["data"]
        attributes = app["attributes"]
        versions = self.all(app_path + "/appStoreVersions", {"filter[platform]": "IOS"})
        if not versions:
            raise AppleError(
                "Create an iOS version in App Store Connect before importing this app."
            )
        versions.sort(
            key=lambda version: version.get("attributes", {}).get("createdDate") or "", reverse=True
        )
        version = next(
            (version for version in versions if state(version) in LIVE_STATES), versions[0]
        )
        infos = [
            item
            for item in self.all(app_path + "/appInfos", {"include": "primaryCategory"})
            if state(item) != "REPLACED_WITH_NEW_INFO"
        ]
        info = next((item for item in infos if state(item) == state(version)), None)
        if info is None:
            info = next(
                (
                    item
                    for item in infos
                    if (state(item) in LIVE_STATES) == (state(version) in LIVE_STATES)
                ),
                None,
            )
        if info is None:
            raise AppleError("Apple has no app information matching this iOS version yet.")
        info_locales = self.all(f"/v1/appInfos/{resource_id(info['id'])}/appInfoLocalizations")
        version_locales = self.all(
            f"/v1/appStoreVersions/{resource_id(version['id'])}/appStoreVersionLocalizations"
        )
        names = {item["attributes"]["locale"]: item["attributes"] for item in info_locales}
        descriptions = {item["attributes"]["locale"]: item for item in version_locales}
        localizations = []
        for locale in sorted(names.keys() | descriptions.keys()):
            text = descriptions.get(locale, {}).get("attributes", {})
            name = names.get(locale, {})
            localizations.append(
                {
                    "locale": locale,
                    "name": name.get("name") or attributes["name"],
                    "subtitle": name.get("subtitle") or "",
                    "description": text.get("description") or "",
                    "keywords": text.get("keywords") or "",
                    "promotional_text": text.get("promotionalText") or "",
                    "whats_new": text.get("whatsNew") or "",
                    "support_url": text.get("supportUrl") or "",
                    "marketing_url": text.get("marketingUrl") or "",
                    "privacy_policy_url": name.get("privacyPolicyUrl") or "",
                }
            )
        primary = attributes.get("primaryLocale", "")
        primary_text = next((item for item in localizations if item["locale"] == primary), {})
        screenshots = []
        if primary in descriptions:
            locale_id = resource_id(descriptions[primary]["id"])
            sets = self.all(f"/v1/appStoreVersionLocalizations/{locale_id}/appScreenshotSets")
            for screenshot_set in sets:
                set_id = resource_id(screenshot_set["id"])
                for screenshot in self.all(f"/v1/appScreenshotSets/{set_id}/appScreenshots"):
                    screenshot_attrs = screenshot["attributes"]
                    url = image_url(screenshot_attrs.get("imageAsset"), 900)
                    if url:
                        screenshots.append(
                            {
                                "url": url,
                                "name": screenshot_attrs.get("fileName", ""),
                                "display_type": screenshot_set["attributes"][
                                    "screenshotDisplayType"
                                ],
                            }
                        )
        icon_id = (app.get("relationships", {}).get("appStoreIcon", {}).get("data") or {}).get("id")
        icon = next(
            (
                item
                for item in response.get("included", [])
                if item["type"] == "buildIcons" and item["id"] == icon_id
            ),
            {},
        )
        category = (info.get("relationships", {}).get("primaryCategory", {}).get("data") or {}).get(
            "id", ""
        )
        return {
            **primary_text,
            "external_id": str(app["id"]),
            "name": primary_text.get("name") or attributes["name"],
            "bundle_id": attributes.get("bundleId", ""),
            "platform": "ios",
            "locale": primary,
            "subtitle": primary_text.get("subtitle", ""),
            "description": primary_text.get("description", ""),
            "category": category.replace("_", " ").title(),
            "category_id": category,
            "version": version["attributes"].get("versionString", ""),
            "version_state": state(version),
            "version_id": version["id"],
            "localizations": localizations,
            "screenshots": screenshots,
            "screenshots_locale": primary,
            "icon_url": image_url(icon.get("attributes", {}).get("iconAsset"), 256),
            "features": [],
            "audience": "",
            "source_note": "Imported from App Store Connect.",
        }
