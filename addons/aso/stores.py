"""Store-specific listing contracts. Missing platform means a historical Apple audit."""

APPLE_FIELDS = ("name", "subtitle", "description", "keywords", "promotional_text")
GOOGLE_FIELDS = ("name", "short_description", "description")
ALL_FIELDS = (*APPLE_FIELDS, "short_description")
LIMITS = {
    "name": 30,
    "subtitle": 30,
    "short_description": 80,
    "description": 4000,
    "keywords": 100,
    "promotional_text": 170,
}


def fields_for(platform="ios"):
    return GOOGLE_FIELDS if platform == "android" else APPLE_FIELDS


def store_key(platform="ios"):
    return "google_play" if platform == "android" else "app_store"


def store_name(platform="ios"):
    return "Google Play" if platform == "android" else "App Store"


def publisher(platform="ios"):
    return "Google" if platform == "android" else "Apple"
