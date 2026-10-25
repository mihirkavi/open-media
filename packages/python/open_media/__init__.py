"""Open Media: the official Python client for the Open Media API.

Public data (the mixed feed, cross-network search, posts, profiles, timelines and events) needs no
key. Account calls need the person's own access token, copied from the app (Settings, then
Developers and agents), and act only as that person.
"""
from __future__ import annotations

import json
import time
import uuid
from typing import Any, Callable, Dict, List, Optional
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

__all__ = ["OpenMedia", "OpenMediaError", "DEFAULT_BASE_URL"]
__version__ = "0.1.0"

DEFAULT_BASE_URL = "https://convo-mail-sync.convo-mail-sync.workers.dev"
NETWORKS = ("open-media", "farcaster", "lens", "hive", "deso")


class OpenMediaError(Exception):
    """An API error with the server's machine-readable code."""

    def __init__(self, status: int, code: str, message: str, retry_after: Optional[int] = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.retry_after = retry_after


Opener = Callable[[Request, float], Any]


class OpenMedia:
    """A client for the Open Media API."""

    def __init__(self, base_url: str = DEFAULT_BASE_URL, token: Optional[str] = None, max_retries: int = 2,
                 timeout: float = 30.0, user_agent: Optional[str] = None, opener: Optional[Opener] = None):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.max_retries = max_retries
        self.timeout = timeout
        self.user_agent = " ".join(filter(None, [f"open-media-python/{__version__}", user_agent]))
        self._open = opener or (lambda request, timeout: urlopen(request, timeout=timeout))

    # Public: no key
    def feed(self, sources: Optional[List[str]] = None, mode: Optional[str] = None, kind: Optional[str] = None, cursor: Optional[str] = None) -> Dict[str, Any]:
        """The mixed feed across Open Media and the open networks, with "why" reasons."""
        return self._get("/v1/feed", {"sources": ",".join(sources) if sources else None, "mode": mode, "kind": kind, "cursor": cursor})

    def search(self, query: str) -> Dict[str, Any]:
        """Plain-language search across public posts on every network, plus matching settings."""
        return self._get("/v1/search", {"q": query})

    def post(self, post_id: str) -> Dict[str, Any]:
        return self._get(f"/v1/posts/{quote(post_id, safe='')}")

    def profile(self, handle: str) -> Dict[str, Any]:
        return self._get(f"/v1/profiles/{quote(handle.lstrip('@'), safe='')}")

    def timeline(self, network: str, handle: str, cursor: Optional[str] = None) -> Dict[str, Any]:
        if network not in NETWORKS:
            raise ValueError(f"network must be one of {', '.join(NETWORKS)}")
        return self._get(f"/v1/people/{network}/{quote(handle.lstrip('@'), safe='')}", {"cursor": cursor})

    def events(self, area: Optional[str] = None, days: Optional[int] = None, query: Optional[str] = None, limit: Optional[int] = None) -> Dict[str, Any]:
        """Upcoming public events in the San Francisco Bay Area, with official registration links."""
        return self._get("/v1/events/upcoming", {"area": area, "days": days, "q": query, "limit": limit})

    def networks(self) -> Dict[str, Any]:
        return self._get("/v1/networks")

    def about(self) -> Dict[str, Any]:
        return self._get("/v1/about")

    # The person's account: needs their token
    def me(self) -> Dict[str, Any]:
        return self._get("/v1/me")

    def publish(self, text: str, idempotency_key: Optional[str] = None) -> Dict[str, Any]:
        """Publishes a public post. Pass the same idempotency_key when retrying."""
        return self._send("POST", "/v1/me/posts", {"text": text}, idempotency_key)

    def delete_post(self, post_id: str) -> Dict[str, Any]:
        return self._send("DELETE", f"/v1/me/posts/{quote(post_id, safe='')}")

    def conversations(self) -> Dict[str, Any]:
        return self._get("/v1/me/conversations")

    def payment_setup(self) -> Dict[str, Any]:
        return self._get("/v1/me/payments/setup")

    def payments(self, limit: int = 50) -> List[Dict[str, Any]]:
        return self._get("/v1/me/payments", {"limit": limit})

    def start_payment(self, context_type: str, context_id: str, rail: str, chain: Optional[str] = None,
                      amount_minor: Optional[int] = None, idempotency_key: Optional[str] = None) -> Dict[str, Any]:
        """Starts a payment once the person agreed to the recipient, amount and fees.

        Card returns checkoutUrl for the person to open; USDC returns the transfer for their own wallet.
        Nothing is paid until Stripe or the network confirms it.
        """
        body: Dict[str, Any] = {"contextType": context_type, "contextId": context_id, "rail": rail}
        if chain:
            body["chain"] = chain
        if amount_minor is not None:
            body["amountMinor"] = amount_minor
        return self._send("POST", "/v1/me/payments", body, idempotency_key)

    def export_data(self) -> Dict[str, Any]:
        return self._get("/v1/me/export")

    # Plumbing
    def _get(self, path: str, query: Optional[Dict[str, Any]] = None) -> Any:
        return self._request("GET", path, query or {})

    def _send(self, method: str, path: str, body: Any = None, idempotency_key: Optional[str] = None) -> Any:
        return self._request(method, path, {}, body, idempotency_key)

    def _request(self, method: str, path: str, query: Dict[str, Any], body: Any = None, idempotency_key: Optional[str] = None) -> Any:
        params = {key: value for key, value in query.items() if value not in (None, "")}
        url = f"{self.base_url}{path}" + (f"?{urlencode(params)}" if params else "")
        headers = {"Accept": "application/json", "User-Agent": self.user_agent}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode()
        if method != "GET":
            # One key for every retry of a write, so a retry never creates a second post or payment.
            headers["Idempotency-Key"] = idempotency_key or str(uuid.uuid4())
        attempt = 0
        while True:
            request = Request(url, data=data, method=method, headers=headers)
            try:
                with self._open(request, self.timeout) as response:
                    text = response.read().decode()
                    return json.loads(text) if text else None
            except HTTPError as error:
                text = error.read().decode() if error.fp else ""
                retry_after = error.headers.get("Retry-After") if error.headers else None
                retry_seconds = int(retry_after) if retry_after and retry_after.isdigit() else None
                if error.code == 429 and attempt < self.max_retries:
                    attempt += 1
                    time.sleep(retry_seconds if retry_seconds is not None else 1)
                    continue
                try:
                    payload = json.loads(text) if text else {}
                except ValueError:
                    payload = {}
                problem = payload.get("error") if isinstance(payload, dict) else None
                code = problem.get("code") if isinstance(problem, dict) else f"http_{error.code}"
                message = problem.get("message") if isinstance(problem, dict) else (problem or f"Open Media answered {error.code}.")
                raise OpenMediaError(error.code, code, message, retry_seconds) from None
