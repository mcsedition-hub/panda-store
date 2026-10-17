"""Fetch only the connected app's imported Apple CDN images; archive bounded inputs."""

import asyncio
import base64
import hashlib

import httpx
from django.utils import timezone

from panda_store.ai.providers import ProviderError
from panda_store.core import images as safe_images
from panda_store.core.images import allowed_url as allowed_url
from panda_store.workflows import services

from .models import ScreenshotEvidence

MAX_IMAGES = 10
MAX_DOWNLOAD = 8_000_000
MAX_STORED = 1_500_000


async def download(url):
    return await safe_images.download(url, max_download=MAX_DOWNLOAD)


def normalize(data):
    return safe_images.normalize(data, max_stored=MAX_STORED)


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
