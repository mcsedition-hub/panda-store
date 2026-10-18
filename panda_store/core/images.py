"""Bounded raster decoding and imported store image downloads shared by modules."""

import asyncio
import hashlib
import io
import re
import warnings
from urllib.parse import urlsplit

import httpx
from PIL import Image, ImageOps, UnidentifiedImageError

STORE_IMAGE_HOSTS = {
    "apple_store": r"is\d+-ssl\.mzstatic\.com",
    "google_play": r"(?:play-lh\.googleusercontent\.com|lh\d+\.(?:googleusercontent|ggpht)\.com)",
}


def allowed_url(url, *, store=None):
    try:
        parsed = urlsplit(url)
        return (
            parsed.scheme == "https"
            and any(
                re.fullmatch(pattern, parsed.hostname or "") is not None
                for provider, pattern in STORE_IMAGE_HOSTS.items()
                if store in (None, provider)
            )
            and parsed.port in {None, 443}
            and parsed.username is None
            and parsed.password is None
            and not parsed.fragment
        )
    except (ValueError, TypeError):
        return False


async def download(url, *, max_download=8_000_000):
    if not allowed_url(url):
        raise ValueError("The imported image is not on a supported store image host.")
    async with asyncio.timeout(12):
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(10, connect=5), follow_redirects=False
        ) as client:
            async with client.stream("GET", url) as response:
                if response.status_code != 200:
                    raise ValueError("The store could not provide this image. Refresh the import.")
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > max_download:
                        raise ValueError("The image exceeds the download size limit.")
                return bytes(data)


def normalize(data, *, max_stored=1_500_000):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as source:
                if (
                    source.format not in {"PNG", "JPEG", "WEBP"}
                    or getattr(source, "n_frames", 1) != 1
                    or source.width * source.height > 20_000_000
                ):
                    raise ValueError("The image format or dimensions are unsupported.")
                source.load()
                image = ImageOps.exif_transpose(source).convert("RGB")
                original = {"width": image.width, "height": image.height}
                image.thumbnail((2048, 2048))
                output = io.BytesIO()
                image.save(output, format="JPEG", quality=90, optimize=True)
                body = output.getvalue()
                if len(body) > max_stored:
                    raise ValueError("The prepared image exceeds the analysis size limit.")
                return body, {
                    "width": image.width,
                    "height": image.height,
                    "downloaded_dimensions": original,
                    "mime_type": "image/jpeg",
                    "sha256": hashlib.sha256(body).hexdigest(),
                }
    except (
        UnidentifiedImageError,
        OSError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ):
        raise ValueError("The imported file could not be read safely as an image.") from None
