"""Bounded browser child process. It never receives workspace keys or browser sessions."""

import base64
import hashlib
import json
import os
import sys
from datetime import UTC, datetime
from urllib.parse import urljoin, urlsplit
from urllib.robotparser import RobotFileParser

from playwright.sync_api import Error, sync_playwright

from .research_network import AccessBlocked, PublicClient
from .research_search import public_url


def launch(playwright, executable):
    return playwright.chromium.launch(
        executable_path=executable,
        headless=True,
        chromium_sandbox=True,
        proxy={"server": "http://127.0.0.1:9", "bypass": "<-loopback>"},
        args=["--disable-quic", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
    )


def capture(url, executable):
    if url is None:
        try:
            with sync_playwright() as playwright:
                browser = launch(playwright, executable)
                browser.close()
            return {"status": "ready"}
        except Exception:
            return {
                "status": "unavailable",
                "reason": "Chromium could not start with its sandbox. "
                "Check the worker browser setup before retrying.",
            }
    trace, images = [], {}
    result = {
        "status": "unavailable",
        "reason": "",
        "text": "",
        "title": "",
        "final_url": "",
        "trace": trace,
        "images": images,
        "hashes": {},
    }
    client = PublicClient()
    robots = {}

    def record(action, **extra):
        trace.append({"action": action, "at": datetime.now(UTC).isoformat(), **extra})

    def permitted(target):
        parts = urlsplit(target)
        origin = f"{parts.scheme}://{parts.netloc}"
        if origin not in robots:
            robot_url = origin + "/robots.txt"
            for _ in range(4):
                code, headers, body = client.fetch(robot_url, limit=256000)
                if code in {301, 302, 303, 307, 308} and headers.get("location"):
                    robot_url = urljoin(robot_url, headers["location"])
                    continue
                break
            parser = RobotFileParser()
            if code in {404, 410}:
                parser.parse([])
            elif code == 200 and not headers.get("content-encoding"):
                parser.parse(body.decode("utf-8", errors="replace").splitlines())
            else:
                raise AccessBlocked("The site's access policy could not be checked.")
            robots[origin] = parser
        if not robots[origin].can_fetch("PandaResearch", target):
            raise AccessBlocked("This page does not allow automated research in robots.txt.")

    try:
        # Gemini's documented grounding links are API redirects, not source pages.
        # Resolve only that exact provider endpoint; the destination still passes
        # the public-IP relay and its own robots/access checks below.
        for _ in range(4):
            parsed = urlsplit(url)
            if (
                parsed.scheme != "https"
                or parsed.netloc != "vertexaisearch.cloud.google.com"
                or not parsed.path.startswith("/grounding-api-redirect/")
            ):
                break
            code, headers, _ = client.fetch(url, limit=256000)
            target = public_url(urljoin(url, headers.get("location", "")))
            if code not in {301, 302, 303, 307, 308} or not target or target == url:
                raise AccessBlocked("The provider's source redirect could not be resolved.")
            record("resolve_provider_link", url=target)
            url = target
        permitted(url)
        with sync_playwright() as playwright:
            browser = launch(playwright, executable)
            context = browser.new_context(
                viewport={"width": 1200, "height": 850},
                locale="en-US",
                service_workers="block",
                accept_downloads=False,
                user_agent="PandaResearch/0.1",
            )
            context.route_web_socket("**/*", lambda ws: ws.close())
            page = context.new_page()
            page.set_default_timeout(5000)
            document_status = []
            blocked = []

            def relay(route):
                request = route.request
                try:
                    if request.method != "GET" or request.resource_type in {
                        "media",
                        "websocket",
                        "eventsource",
                    }:
                        raise AccessBlocked(
                            "This browser only reads public pages and still images."
                        )
                    if request.is_navigation_request():
                        if request.frame != page.main_frame:
                            raise AccessBlocked("Embedded frames are not inspected.")
                        permitted(request.url)
                    code, headers, body = client.fetch(request.url)
                    if request.is_navigation_request():
                        document_status.append(code)
                    headers = {
                        k: v
                        for k, v in headers.items()
                        if k
                        not in {"content-length", "transfer-encoding", "connection", "set-cookie"}
                    }
                    route.fulfill(status=code, headers=headers, body=body)
                except Exception as exc:
                    # Deliberately never continue(): all external I/O must pass the public-IP relay.
                    if request.is_navigation_request() and request.frame == page.main_frame:
                        blocked.append(
                            str(exc)
                            if isinstance(exc, AccessBlocked)
                            else "The page could not be reached."
                        )
                    route.abort()

            context.route("**/*", relay)
            record("open", url=url)
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=35000)
                page.wait_for_timeout(500)
                result["final_url"] = public_url(page.url) or ""
                if not result["final_url"]:
                    raise AccessBlocked("The page navigated outside supported public URLs.")
                result["title"] = page.title()[:300]
                parts = []
                for name in ("top", "scroll"):
                    if name == "scroll":
                        page.evaluate("window.scrollBy(0, Math.round(window.innerHeight * 0.85))")
                        page.wait_for_timeout(400)
                        record("scroll", y=page.evaluate("Math.round(window.scrollY)"))
                    parts.append(page.locator("body").inner_text()[:12000])
                    data = page.screenshot(type="jpeg", quality=65, timeout=5000)
                    if len(data) > 1_000_000:
                        raise AccessBlocked("The rendered page exceeded the capture size limit.")
                    images[name] = base64.b64encode(data).decode()
                    result["hashes"][name] = hashlib.sha256(data).hexdigest()
                    record("capture", frame=name)
                result["text"] = "\n".join(dict.fromkeys(parts))[:16000]
                challenge = any(
                    phrase in (result["title"] + "\n" + result["text"][:1000]).lower()
                    for phrase in (
                        "verify you are human",
                        "checking your browser",
                        "just a moment...",
                        "captcha",
                        "access denied",
                        "log in to continue",
                        "sign in to continue",
                        "login • instagram",
                        "log in • instagram",
                    )
                )
                if blocked or not document_status or document_status[-1] >= 400 or challenge:
                    result["reason"] = (
                        blocked[0]
                        if blocked
                        else "The page is restricted, unavailable or requires a sign-in/challenge."
                    )
                elif len(result["text"].strip()) < 120:
                    result["reason"] = (
                        "Too little readable page text. Video and audio were not played."
                    )
                else:
                    result["status"] = "observed"
                    result["reason"] = (
                        "Two page positions captured. Video, audio, embedded frames "
                        "and gated content were not inspected."
                    )
            except (Error, AccessBlocked):
                result["reason"] = (
                    blocked[0]
                    if blocked
                    else "The page could not be fully read within its browser budget."
                )
            finally:
                browser.close()
    except AccessBlocked as exc:
        result["reason"] = str(exc)
    except Exception:
        result["reason"] = (
            "The isolated browser could not open this page. Check the worker's "
            "Chromium installation and sandbox support."
        )
    finally:
        client.close()
    return result


if __name__ == "__main__":
    payload = json.loads(sys.stdin.read(10000))
    print(json.dumps(capture(payload["url"], os.environ["PANDA_RESEARCH_CHROMIUM_PATH"])))
