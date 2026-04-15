"""Platform API client: Agent → Next.js Control Plane 通信。"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import httpx

from .config import settings
from .exceptions import PlatformAPIError
from .schema import ItemBatchInput, ItemInput


def _wrap_request(method: str, url: str, fn: Any) -> Any:
    """Execute *fn* and translate httpx errors into PlatformAPIError."""
    try:
        return fn()
    except httpx.HTTPStatusError as e:
        raise PlatformAPIError(
            f"Platform API {method} {url} returned {e.response.status_code}",
            url=url,
            method=method,
            status_code=e.response.status_code,
        ) from e
    except httpx.RequestError as e:
        raise PlatformAPIError(
            f"Platform API {method} {url} request failed: {e}",
            url=url,
            method=method,
        ) from e


class PlatformClient:
    def __init__(
        self,
        base_url: str | None = None,
        token: str | None = None,
        timeout: float = 15.0,
    ) -> None:
        self.base_url = (base_url or settings.platform_api_base).rstrip("/")
        self.token = token or settings.radar_write_token
        self.timeout = timeout

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

    def _client(self) -> httpx.Client:
        # trust_env=False 避免走 ClashX 代理到本地 127.0.0.1
        return httpx.Client(timeout=self.timeout, trust_env=False)

    # ── Items ──

    def post_items_batch(self, round_at: datetime, items: list[ItemInput]) -> dict[str, Any]:
        batch = ItemBatchInput(round_at=round_at, items=items)
        payload = batch.model_dump(mode="json")
        url = f"{self.base_url}/api/items/batch"

        def _call() -> dict[str, Any]:
            with self._client() as client:
                resp = client.post(url, json=payload, headers=self._headers())
                resp.raise_for_status()
                return resp.json()

        return _wrap_request("POST", url, _call)

    # ── Sources ──

    def get_sources(self, agent_id: str | None = None) -> dict[str, Any]:
        url = f"{self.base_url}/api/sources"
        params = {}
        if agent_id:
            params["agent_id"] = agent_id

        def _call() -> dict[str, Any]:
            with self._client() as client:
                resp = client.get(url, params=params, headers=self._headers())
                resp.raise_for_status()
                return resp.json()

        return _wrap_request("GET", url, _call)

    # ── Raw Items ──

    def post_raw_items_batch(
        self, items: list[dict[str, Any]], run_id: str | None = None
    ) -> dict[str, Any]:
        url = f"{self.base_url}/api/raw-items/batch"
        payload: dict[str, Any] = {"items": items}
        if run_id:
            payload["run_id"] = run_id

        def _call() -> dict[str, Any]:
            with self._client() as client:
                resp = client.post(url, json=payload, headers=self._headers())
                resp.raise_for_status()
                return resp.json()

        return _wrap_request("POST", url, _call)

    def get_raw_items(
        self,
        agent_id: str | None = None,
        status: str | None = None,
        run_id: str | None = None,
        limit: int | None = None,
    ) -> dict[str, Any]:
        url = f"{self.base_url}/api/raw-items"
        params: dict[str, str] = {}
        if agent_id:
            params["agent_id"] = agent_id
        if status:
            params["status"] = status
        if run_id:
            params["run_id"] = run_id
        if limit:
            params["limit"] = str(limit)

        def _call() -> dict[str, Any]:
            with self._client() as client:
                resp = client.get(url, params=params, headers=self._headers())
                resp.raise_for_status()
                return resp.json()

        return _wrap_request("GET", url, _call)

    def update_raw_items_status(self, ids: list[str], status: str) -> dict[str, Any]:
        url = f"{self.base_url}/api/raw-items/batch-status"

        def _call() -> dict[str, Any]:
            with self._client() as client:
                resp = client.patch(
                    url,
                    json={"ids": ids, "status": status},
                    headers=self._headers(),
                )
                resp.raise_for_status()
                return resp.json()

        return _wrap_request("PATCH", url, _call)

    # ── Runs ──

    def create_run(
        self,
        agent_id: str,
        phase: str,
        source_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        url = f"{self.base_url}/api/runs"
        payload: dict[str, Any] = {"agent_id": agent_id, "phase": phase}
        if source_ids:
            payload["source_ids"] = source_ids

        def _call() -> dict[str, Any]:
            with self._client() as client:
                resp = client.post(url, json=payload, headers=self._headers())
                resp.raise_for_status()
                return resp.json()

        return _wrap_request("POST", url, _call)

    # ── Items (read) ──

    def get_items(
        self,
        agent_id: str | None = None,
        grade: str | None = None,
        limit: int | None = None,
    ) -> dict[str, Any]:
        url = f"{self.base_url}/api/items"
        params: dict[str, str] = {}
        if agent_id:
            params["agent_id"] = agent_id
        if grade:
            params["grade"] = grade
        if limit:
            params["limit"] = str(limit)

        def _call() -> dict[str, Any]:
            with self._client() as client:
                resp = client.get(url, params=params, headers=self._headers())
                resp.raise_for_status()
                return resp.json()

        return _wrap_request("GET", url, _call)

    # ── Chat Persistence ──

    def persist_chat(
        self, thread_id: str, agent_id: str, messages: list[dict[str, Any]]
    ) -> dict[str, Any]:
        """Persist chat messages to D1 via BFF endpoint.

        Best-effort: callers should catch exceptions and log rather than
        propagating failures to the user.
        """
        url = f"{self.base_url}/api/chat/persist"
        payload = {
            "agent_id": agent_id,
            "thread_id": thread_id,
            "messages": messages,
        }

        def _call() -> dict[str, Any]:
            with self._client() as client:
                resp = client.post(url, json=payload, headers=self._headers())
                resp.raise_for_status()
                return resp.json()

        return _wrap_request("POST", url, _call)

    # ── LLM Settings ──

    def get_llm_settings(self) -> dict[str, Any]:
        url = f"{self.base_url}/api/settings?internal=true"

        def _call() -> dict[str, Any]:
            with self._client() as client:
                resp = client.get(url, headers=self._headers())
                resp.raise_for_status()
                return resp.json()

        return _wrap_request("GET", url, _call)

    def update_run(self, run_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        url = f"{self.base_url}/api/runs/{run_id}"

        def _call() -> dict[str, Any]:
            with self._client() as client:
                resp = client.patch(url, json=patch, headers=self._headers())
                resp.raise_for_status()
                return resp.json()

        return _wrap_request("PATCH", url, _call)
