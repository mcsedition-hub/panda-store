"""Fetch only the connected app's imported Apple CDN images; archive bounded inputs."""

import asyncio
import base64
import hashlib
import io
import re
import warnings
from urllib.parse import urlsplit

import httpx
from django.utils import timezone
from PIL import Image, ImageOps, UnidentifiedImageError

from panda_store.ai.providers import ProviderError
from panda_store.workflows import services

from .models import ScreenshotEvidence

MAX_IMAGES = 10
MAX_DOWNLOAD = 8_000_000
MAX_STORED = 1_500_000


def allowed_url(url):
    try:
        parsed = urlsplit(url)
        return (
            parsed.scheme == "https"
            and re.fullmatch(r"is\d+-ssl\.mzstatic\.com", parsed.hostname or "") is not None
            and parsed.port in {None, 443}
            and parsed.username is None
            and parsed.password is None
            and not parsed.fragment
        )
    except (ValueError, TypeError):
        return False


async def download(url):
    if not allowed_url(url):
        raise ValueError("The imported image is not on a supported Apple image host.")
    async with asyncio.timeout(12):
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(10, connect=5), follow_redirects=False
        ) as client:
            async with client.stream("GET", url) as response:
                if response.status_code != 200:
                    raise ValueError("Apple could not provide this image. Refresh the import.")
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > MAX_DOWNLOAD:
                        raise ValueError("The image exceeds the download size limit.")
                return bytes(data)


async def download_batch(items):
    results = []
    # This is a whole-batch deadline, including a server that trickles response bytes.
    try:
        async with asyncio.timeout(45):
            for item in items:
                try:
                    results.append((await download(item.get("url", "")), ""))
                except (TimeoutError, httpx.HTTPError):
                    results.append((None, "The image download failed or timed out."))
                except ValueError as exc:
                    results.append((None, str(exc)))
    except TimeoutError:
        pass
    results.extend(
        [(None, "The image download time budget was reached.")] * (len(items) - len(results))
    )
    return results


def normalize(data):
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
                if len(body) > MAX_STORED:
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


def capture(run, token):
    metadata = run.inputs["metadata"]
    if metadata.get("screenshots_locale") != run.locale:
        raise ProviderError("No screenshots were imported for this language. Refresh the import.")
    items = metadata.get("screenshots", [])[:MAX_IMAGES]
    downloaded = asyncio.run(download_batch(items))
    manifest = []
    for position, (item, (data, error)) in enumerate(zip(items, downloaded, strict=True), 1):
        info = {
            "image_id": f"shot-{position}",
            "position": position,
            "name": item.get("name", ""),
            "display_type": item.get("display_type", ""),
            "captured_at": timezone.now().isoformat(),
        }
        if data is not None:
            try:
                body, details = normalize(data)
                info.update(details)
                with services.execution_lock(run.workflow_id, token):
                    asset, _ = ScreenshotEvidence.objects.get_or_create(
                        audit=run, position=position, defaults={"metadata": info, "data": body}
                    )
                    info = {**asset.metadata, "asset_id": str(asset.pk)}
            except ValueError as exc:
                error = str(exc)
        info["error"] = error
        manifest.append(info)
    if not any(item.get("asset_id") for item in manifest):
        raise ProviderError("No screenshot could be loaded. Refresh the app import and retry.")
    return {"images": manifest, "total_imported": len(metadata.get("screenshots", []))}


def model_images(run, manifest):
    result = []
    for item in manifest["images"]:
        if not item.get("asset_id"):
            continue
        asset = ScreenshotEvidence.objects.get(
            pk=item["asset_id"], audit__workspace_id=run.workspace_id, audit__app_id=run.app_id
        )
        body = bytes(asset.data)
        if hashlib.sha256(body).hexdigest() != item["sha256"]:
            raise ProviderError("A saved screenshot could not be verified. Start a new review.")
        result.append(
            {
                "id": item["image_id"],
                "mime_type": item["mime_type"],
                "data": base64.b64encode(body).decode("ascii"),
            }
        )
    return result
