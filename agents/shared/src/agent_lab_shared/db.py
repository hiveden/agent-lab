"""Platform API client: 把 Agent 产出 POST 到 Next.js /api/items/batch。"""

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

    def post_items_batch(
        self, round_at: datetime, items: list[ItemInput]
    ) -> dict[str, Any]:
        """把一批 item POST 到 /api/items/batch。平台 API 不走代理(本地回环)。"""
        batch = ItemBatchInput(round_at=round_at, items=items)
        payload = batch.model_dump(mode="json")
        url = f"{self.base_url}/api/items/batch"

        # 显式 trust_env=False,避免走 ClashX 代理到本地 127.0.0.1
        with httpx.Client(timeout=self.timeout, trust_env=False) as client:
            resp = client.post(url, json=payload, headers=self._headers())
            resp.raise_for_status()
            return resp.json()
