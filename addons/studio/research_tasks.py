import base64
import json
import logging
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

from celery import shared_task
from django.conf import settings
from django.db import close_old_connections, connections
from playwright.sync_api import sync_playwright

from panda_store.ai.context import include_app_context
from panda_store.ai.providers import ProviderError
from panda_store.core.credentials import CredentialsUnavailable
from panda_store.workflows import services

from . import research_analysis as analysis
from .models import ResearchPage, ResearchRun
from .research_search import search

logger = logging.getLogger(__name__)


def browser_path():
    with sync_playwright() as playwright:
        return playwright.chromium.executable_path


def browser_ready():
    return Path(browser_path()).is_file()


def browse(url, run, token):
    with tempfile.TemporaryDirectory(prefix="panda-research-") as temporary:
        # No .env, API tokens, personal browser profile or cookies enter this process.
        environment = {
            "PATH": os.defpath,
            "HOME": temporary,
            "TMPDIR": temporary,
            "LANG": "en_US.UTF-8",
            "PANDA_RESEARCH_CHROMIUM_PATH": browser_path(),
        }
        process = subprocess.Popen(
            [sys.executable, "-m", "addons.studio.research_browser"],
            cwd=settings.BASE_DIR,
            env=environment,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        deadline = time.monotonic() + 65
        payload = json.dumps({"url": url}).encode()
        try:
            while True:
                try:
                    output, _ = process.communicate(input=payload, timeout=1)
                    if process.returncode or len(output) > 4_000_000:
                        raise ValueError()
                    return json.loads(output)
                except subprocess.TimeoutExpired:
                    payload = None
                    with services.execution_lock(run.workflow_id, token):
                        pass
                    if time.monotonic() >= deadline:
                        raise TimeoutError() from None
        except (ValueError, TimeoutError):
            return {
                "status": "unavailable",
                "reason": "The page exceeded its isolated browser budget or could not be rendered.",
                "text": "",
                "title": "",
                "final_url": "",
                "trace": [],
                "images": {},
                "hashes": {},
            }
        finally:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()


@shared_task(
    soft_time_limit=3 * settings.PANDA_AI_TIMEOUT_SECONDS + 660,
    time_limit=3 * settings.PANDA_AI_TIMEOUT_SECONDS + 690,
)
def research(workflow_id):
    run = ResearchRun.objects.get(workflow_id=workflow_id)
    token = services.claim(workflow_id)
    if token is None:
        return
    stopped = threading.Event()

    def keep_alive():
        try:
            while not stopped.wait(10):
                close_old_connections()
                if not services.heartbeat(workflow_id, token):
                    return
        finally:
            connections.close_all()

    heartbeat = threading.Thread(target=keep_alive, daemon=True)
    heartbeat.start()
    try:
        checked = services.start_step(
            workflow_id,
            token,
            "context",
            "Checking the saved app context and Chromium installation.",
        )
        if checked is None:
            if not browser_ready():
                raise ProviderError(
                    "Install the research browser on the worker: "
                    "python -m playwright install chromium."
                )
            analysis.connection(run)
            probe = browse(None, run, token)
            if probe["status"] != "ready":
                raise ProviderError(probe["reason"])
            services.complete_step(
                workflow_id,
                token,
                "context",
                "Saved context selected. Public pages only; no signed-in browser session.",
                {"snapshot_id": run.inputs["snapshot_id"]},
            )
        discovery = services.start_step(
            workflow_id,
            token,
            "discover",
            "Searching with the selected provider. Search tool fees may apply.",
        )
        if discovery is None:
            choice = run.inputs["ai"]
            discovery = search(
                choice["provider"],
                analysis.connection(run),
                choice["model"],
                include_app_context(
                    run.inputs,
                    {
                        "app": run.inputs["app"],
                        "topic": run.inputs["topic"],
                        "market": run.inputs["market"],
                        "purpose": "smm_launch",
                    },
                ),
                response_language=run.inputs.get("response_language", "en"),
            )
            services.complete_step(
                workflow_id,
                token,
                "discover",
                f"{len(discovery['sources'])} candidate sources found. "
                "Their pages still need to be inspected.",
                discovery,
            )
        saved = services.start_step(
            workflow_id,
            token,
            "browse",
            "Opening up to six discovered pages and three cross-domain store references.",
        )
        root = run.evidence_root or run
        if saved is None:
            sources = [*discovery["sources"], *run.inputs["references"]]
            for position, source in enumerate(sources):
                if root.pages.filter(position=position).exists():
                    services.progress(
                        workflow_id,
                        token,
                        "browse",
                        f"Reusing saved page evidence: {source['title']}.",
                    )
                    continue
                services.progress(
                    workflow_id,
                    token,
                    "browse",
                    f"Opening {source['title']}. Two page positions will be inspected.",
                )
                result = browse(source["url"], run, token)
                images = result.pop("images")
                with services.execution_lock(workflow_id, token):
                    ResearchPage.objects.create(
                        run=root,
                        position=position,
                        source=source,
                        top_image=base64.b64decode(images["top"]) if images.get("top") else None,
                        scroll_image=base64.b64decode(images["scroll"])
                        if images.get("scroll")
                        else None,
                        **result,
                    )
                    services.progress(
                        workflow_id,
                        token,
                        "browse",
                        f"{source['title']}: {result['status']}. {result['reason']}",
                    )
            pages = list(root.pages.all())
            services.complete_step(
                workflow_id,
                token,
                "browse",
                f"{sum(p.status == 'observed' for p in pages)} of {len(pages)} pages readable. "
                "Coverage saved for every source.",
                {"page_ids": [str(p.pk) for p in pages]},
            )
        else:
            pages = list(root.pages.filter(pk__in=saved["page_ids"]))
            if len(pages) != len(saved["page_ids"]):
                raise ProviderError("Saved research evidence is missing. Start new research.")
        output = services.start_step(
            workflow_id,
            token,
            "analyze",
            "Analyzing the saved text and stills. Video and audio are outside this review.",
        )
        if output is None:
            output = (
                analysis.call(run, pages)
                if any(p.status == "observed" for p in pages)
                else {"result": {"findings": []}, "usage": {}}
            )
            analysis.candidates(output, pages)
            services.complete_step(
                workflow_id,
                token,
                "analyze",
                "Candidate observations received; checking their exact evidence.",
                output,
            )
        findings, withheld = analysis.candidates(output, pages)
        review = services.start_step(
            workflow_id,
            token,
            "verify",
            "Separately checking claims against the same saved evidence.",
        )
        if review is None:
            review = (
                analysis.call(run, pages, findings)
                if findings
                else {"result": {"reviews": []}, "usage": {}}
            )
            analysis.verified(findings, review)
            services.complete_step(
                workflow_id,
                token,
                "verify",
                "Evidence review completed. Unsupported observations withheld.",
                review,
            )
        findings, rejected = analysis.verified(findings, review)
        services.start_step(
            workflow_id, token, "report", "Saving findings, source coverage and model usage."
        )
        with services.execution_lock(workflow_id, token):
            run.report = {
                "findings": findings,
                "withheld": withheld + rejected,
                "discovery": discovery,
                "calls": [
                    {
                        "step": step,
                        **{
                            k: value.get(k)
                            for k in ("provider", "model", "resolved_model", "usage")
                        },
                    }
                    for step, value in (
                        ("discover", discovery),
                        ("analyze", output),
                        ("verify", review),
                    )
                ],
                "coverage": {
                    "observed": sum(p.status == "observed" for p in pages),
                    "attempted": len(pages),
                    "references_observed": sum(
                        p.status == "observed" and p.source["kind"] == "reference" for p in pages
                    ),
                    "references_expected": 3,
                },
            }
            run.save(update_fields=["report"])
            services.complete_step(
                workflow_id,
                token,
                "report",
                f"{len(findings)} findings retained for your review. "
                "No performance gains established.",
            )
            services.succeed(
                workflow_id,
                token,
                "Research saved. Review source coverage before preparing creative work.",
            )
    except services.ExecutionStopped:
        services.fail(workflow_id, "The research worker stopped. Retry unfinished steps.", token)
    except (ProviderError, CredentialsUnavailable) as exc:
        services.fail(workflow_id, str(exc), token)
    except Exception:
        logger.exception("Research failed for %s", run.pk)
        services.fail(
            workflow_id, "Research failed. Retry unfinished steps; saved pages are retained.", token
        )
    finally:
        stopped.set()
        heartbeat.join(timeout=2)
