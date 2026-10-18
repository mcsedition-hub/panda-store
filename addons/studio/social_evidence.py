"""Validate browser observations and qualify performance without model-created counts."""

import base64
import io
import re
from decimal import Decimal, InvalidOperation
from urllib.parse import parse_qs, urlsplit

from PIL import Image
from rest_framework.exceptions import ValidationError

PLATFORMS = ("tiktok", "instagram", "facebook", "google")
FORMATS = ("carousel", "ugc", "text", "montage", "human_video", "video", "unknown")
HOSTS = {
    "tiktok": {"www.tiktok.com", "tiktok.com"},
    "instagram": {"www.instagram.com", "instagram.com"},
    "facebook": {"www.facebook.com", "facebook.com", "m.facebook.com"},
}


def post_url(value):
    try:
        url = urlsplit(value)
        if url.scheme != "https" or url.username or url.password or url.port:
            raise ValueError()
        platform = next((p for p, hosts in HOSTS.items() if url.hostname in hosts), None)
        if platform == "facebook" and url.path == "/permalink.php":
            query = parse_qs(url.query, keep_blank_values=True)
            stories, pages = query.get("story_fbid", []), query.get("id", [])
            if (
                len(stories) != 1
                or len(pages) != 1
                or not re.fullmatch(r"(?:[0-9]+|pfbid[A-Za-z0-9]+)", stories[0])
                or not re.fullmatch(r"[0-9]+", pages[0])
            ):
                raise ValueError()
            return (
                platform,
                f"https://www.facebook.com/permalink.php?story_fbid={stories[0]}&id={pages[0]}",
            )
        patterns = {
            "tiktok": r"/@[\w.]+/(video|photo)/\d+/?$",
            "instagram": r"/(p|reel)/[\w-]+/?$",
            "facebook": r"/(?:reel/\d+|[\w.]+/(?:posts|videos)/[\w.]+|watch/?)/*$",
        }
        if not platform or not re.fullmatch(patterns[platform], url.path):
            raise ValueError()
        if platform == "facebook" and url.path.rstrip("/") == "/watch":
            # Watch URLs need a post id; arbitrary query strings never enter the collector.
            if not re.fullmatch(r"v=\d+", url.query):
                raise ValueError()
            return platform, f"https://www.facebook.com/watch/?{url.query}"
        return platform, f"https://www.{platform}.com{url.path.rstrip('/')}"
    except (TypeError, ValueError, AttributeError):
        raise ValidationError("Choose a direct TikTok, Instagram or Facebook post URL.") from None


def count(raw):
    """Only explicit counters. Localized ambiguous bare numbers stay unknown."""
    if not isinstance(raw, str) or len(raw) > 40:
        return None
    text = raw.strip().lower().replace("\u202f", " ").replace("\xa0", " ")
    match = re.fullmatch(r"(\d+(?:[., ]\d+)*)(?:\s*(k|m|b|万|亿))?", text)
    if not match:
        return None
    digits, suffix = match.groups()
    if suffix:
        if " " in digits or ("." in digits and "," in digits):
            return None
        digits = digits.replace(",", ".")
    elif re.fullmatch(r"\d{1,3}(?:[, ]\d{3})+", digits):
        digits = re.sub(r"[, ]", "", digits)
    elif not digits.isdigit():
        return None
    try:
        number = (
            Decimal(digits)
            * {None: 1, "k": 1000, "m": 1000000, "b": 1000000000, "万": 10000, "亿": 100000000}[
                suffix
            ]
        )
        if number < 0 or number > 10**12 or number != int(number):
            return None
        return int(number)
    except (InvalidOperation, ValueError):
        return None


def validate_capture(data):
    if not isinstance(data, dict):
        raise ValidationError("Invalid browser capture.")
    platform, url = post_url(data.get("url"))
    clean = {"platform": platform, "url": url}
    limits = {
        "title": 500,
        "caption": 10000,
        "text": 24000,
        "author": 200,
        "published_at": 100,
        "coverage": 1000,
        "blocked_reason": 500,
    }
    for name, limit in limits.items():
        value = data.get(name, "")
        if not isinstance(value, str) or len(value) > limit:
            raise ValidationError(f"Invalid {name} in browser capture.")
        clean[name] = value
    fmt = data.get("format", "unknown")
    if fmt not in FORMATS:
        raise ValidationError("Unknown content format.")
    clean["format"] = fmt
    clean["observed_at"] = str(data.get("observed_at", ""))[:100]
    metrics = {}
    raw_metrics = data.get("metrics", {})
    if not isinstance(raw_metrics, dict):
        raise ValidationError("Invalid observed counters.")
    for key in ("views", "likes", "comments", "shares"):
        metric = raw_metrics.get(key)
        if not isinstance(metric, dict):
            continue
        raw, quote = metric.get("raw"), metric.get("quote")
        if not isinstance(raw, str) or not isinstance(quote, str):
            continue
        # Browser selectors supply a scoped element's visible text; no model-generated counts.
        if not raw or len(raw) > 40 or not quote or len(quote) > 240:
            continue
        if raw not in quote or quote not in clean["text"]:
            continue
        # Older connectors mistook unlabelled search-card engagement for video views.
        if key == "views" and quote.startswith("Search card for "):
            continue
        value = count(raw)
        if value is not None:
            metrics[key] = {
                "value": value,
                "raw": raw,
                "quote": quote,
                "approximate": bool(re.search(r"[a-z万亿]", raw, re.I)),
            }
    clean["metrics"] = raw_metrics = {
        k: {x: v[x] for x in ("raw", "quote")} for k, v in metrics.items()
    }
    frames = data.get("frames", [])
    if not isinstance(frames, list) or len(frames) > 3:
        raise ValidationError("At most three frames per post.")
    validated_frames = []
    for frame in frames:
        if not isinstance(frame, str) or len(frame) > 275000:
            raise ValidationError("The captured frame is too large.")
        try:
            raw = base64.b64decode(frame, validate=True)
            with Image.open(io.BytesIO(raw)) as image:
                if image.format != "JPEG" or image.width * image.height > 3000000:
                    raise ValueError()
                image.verify()
        except Exception:
            raise ValidationError("Invalid JPEG evidence.") from None
        validated_frames.append(frame)
    return clean, metrics, validated_frames


def qualify(evidence, metrics, thresholds, *, content_format=None):
    fmt = content_format or evidence["format"]
    reasons = []
    if evidence["blocked_reason"]:
        reasons.append("The post could not be observed: " + evidence["blocked_reason"])
    if fmt == "unknown":
        reasons.append("Content format is not established.")
    keys = ["likes"] if fmt in {"carousel", "text"} else ["views", "likes"]
    for key in keys:
        actual = metrics.get(key, {}).get("value")
        minimum = thresholds["min_" + key]
        if actual is None:
            reasons.append(f"{key.title()} were not observed.")
        elif actual < minimum:
            reasons.append(f"{key.title()} {actual:,} is below the {minimum:,} filter.")
    if not evidence["caption"] and not evidence["text"]:
        reasons.append("No content evidence was collected.")
    views, likes = (metrics.get(k, {}).get("value") for k in ("views", "likes"))
    return {
        "status": "unqualified" if reasons else "metrics_pass",
        "reasons": reasons,
        "thresholds": thresholds,
        "like_rate": round(likes / views, 5) if views and likes is not None else None,
    }
