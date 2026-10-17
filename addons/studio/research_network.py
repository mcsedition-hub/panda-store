"""Public-only HTTP transport for the browser relay. No redirects or environment proxy."""

import ipaddress
import socket
import time
from urllib.parse import urlsplit

import httpcore


class AccessBlocked(Exception):
    pass


def address(host, port):
    try:
        addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
            raise AccessBlocked("Private and reserved network addresses are blocked.")
        return addresses[0][4][0]
    except (ValueError, OSError) as exc:
        raise AccessBlocked("This host could not be resolved to a public address.") from exc


class PublicNetwork(httpcore.SyncBackend):
    def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        if port not in {80, 443}:
            raise AccessBlocked("Only public HTTP and HTTPS ports are supported.")
        # Pin the checked IP; httpcore retains the original hostname for TLS verification/SNI.
        return super().connect_tcp(
            address(host, port), port, timeout, local_address, socket_options
        )


class PublicClient:
    def __init__(self, seconds=45):
        self.deadline = time.monotonic() + seconds
        self.pool = httpcore.ConnectionPool(
            network_backend=PublicNetwork(), max_connections=4, retries=0
        )
        self.total = 0
        self.requests = 0

    def close(self):
        self.pool.close()

    def fetch(self, url, *, limit=3_000_000):
        from .research_search import public_url

        if not public_url(url):
            raise AccessBlocked(
                "Only public HTTP and HTTPS URLs without credentials are supported."
            )
        self.requests += 1
        if self.requests > 120 or self.total > 20_000_000 or time.monotonic() >= self.deadline:
            raise AccessBlocked("The page reached its time or network budget.")
        timeout = min(7, max(0.1, self.deadline - time.monotonic()))
        host = urlsplit(url).netloc
        headers = {
            "Host": host,
            "User-Agent": "PandaResearch/0.1",
            "Accept": "*/*",
            "Accept-Encoding": "identity",
        }
        with self.pool.stream(
            "GET",
            url,
            headers=headers,
            extensions={"timeout": {k: timeout for k in ("connect", "read", "write", "pool")}},
        ) as response:
            body = bytearray()
            for chunk in response.iter_stream():
                body.extend(chunk)
                self.total += len(chunk)
                if len(body) > limit or self.total > 20_000_000 or time.monotonic() > self.deadline:
                    raise AccessBlocked("The page reached its time or size budget.")
            return (
                response.status,
                {k.decode("latin1").lower(): v.decode("latin1") for k, v in response.headers},
                bytes(body),
            )
