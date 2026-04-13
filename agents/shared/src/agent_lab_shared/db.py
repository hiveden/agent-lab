"""Platform API client: Agent → Next.js Control Plane 通信。"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import httpx

from .config import settings
from .schema import ItemBatchInput, ItemInput


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
        with self._client() as client:
            resp = client.post(url, json=payload, headers=self._headers())
            resp.raise_for_status()
            return resp.json()

    # ── Sources ──

    def get_sources(self, agent_id: str | None = None) -> dict[str, Any]:
        url = f"{self.base_url}/api/sources"
        params = {}
        if agent_id:
            params["agent_id"] = agent_id
        with self._client() as client:
            resp = client.get(url, params=params, headers=self._headers())
            resp.raise_for_status()
            return resp.json()

    # ── Raw Items ──

    def post_raw_items_batch(
        self, items: list[dict[str, Any]], run_id: str | None = None
    ) -> dict[str, Any]:
        url = f"{self.base_url}/api/raw-items/batch"
        payload: dict[str, Any] = {"items": items}
        if run_id:
            payload["run_id"] = run_id
        with self._client() as client:
            resp = client.post(url, json=payload, headers=self._headers())
            resp.raise_for_status()
            return resp.json()

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
        with self._client() as client:
            resp = client.get(url, params=params, headers=self._headers())
            resp.raise_for_status()
            return resp.json()

    def update_raw_items_status(self, ids: list[str], status: str) -> dict[str, Any]:
        url = f"{self.base_url}/api/raw-items/batch-status"
        with self._client() as client:
            resp = client.patch(
                url,
                json={"ids": ids, "status": status},
                headers=self._headers(),
            )
            resp.raise_for_status()
            return resp.json()

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
        with self._client() as client:
            resp = client.post(url, json=payload, headers=self._headers())
            resp.raise_for_status()
            return resp.json()

    # ── LLM Settings ──

    def get_llm_settings(self) -> dict[str, Any]:
        url = f"{self.base_url}/api/settings?internal=true"
        with self._client() as client:
            resp = client.get(url, headers=self._headers())
            resp.raise_for_status()
            return resp.json()

    def update_run(self, run_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        url = f"{self.base_url}/api/runs/{run_id}"
        with self._client() as client:
            resp = client.patch(url, json=patch, headers=self._headers())
            resp.raise_for_status()
            return resp.json()
