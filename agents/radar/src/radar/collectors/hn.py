"""Hacker News collector，符合 Collector Protocol。"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from ..exceptions import CollectorError
from .base import RawCollectorItem, proxy_kwargs

logger = logging.getLogger(__name__)

HN_BASE = "https://hacker-news.firebaseio.com/v0"
DEFAULT_LIMIT = 30


async def _fetch_item(client: httpx.AsyncClient, item_id: int) -> dict[str, Any] | None:
    try:
        resp = await client.get(f"{HN_BASE}/item/{item_id}.json")
        resp.raise_for_status()
        data = resp.json()
        if not data:
            return None
        return data
    except (httpx.HTTPError, ValueError) as e:
        logger.debug("Failed to fetch HN item %d: %s", item_id, e)
        return None


async def _collect_async(limit: int = DEFAULT_LIMIT) -> list[RawCollectorItem]:
    client_kwargs: dict[str, Any] = {"timeout": 20.0, "trust_env": False, **proxy_kwargs()}
    top_url = f"{HN_BASE}/topstories.json"
    async with httpx.AsyncClient(**client_kwargs) as client:
        try:
            top_resp = await client.get(top_url)
            top_resp.raise_for_status()
        except httpx.HTTPError as e:
            raise CollectorError(
                f"Failed to fetch HN top stories: {e}",
                context={"url": top_url, "source_type": "hacker-news"},
            ) from e
        try:
            ids: list[int] = top_resp.json()[:limit]
        except ValueError as e:
            raise CollectorError(
                "Failed to parse HN top stories response as JSON",
                context={"url": top_url, "source_type": "hacker-news"},
            ) from e

        raw = await asyncio.gather(*(_fetch_item(client, i) for i in ids))

    results: list[RawCollectorItem] = []
    for item in raw:
        if not item:
            continue
        if not item.get("url"):
            continue
        results.append(
            RawCollectorItem(
                external_id=str(item.get("id")),
                title=item.get("title", ""),
                url=item.get("url"),
                raw_payload={
                    "hn_id": item.get("id"),
                    "score": item.get("score", 0),
                    "by": item.get("by", ""),
                    "time": item.get("time", 0),
                },
            )
        )
    return results


class HNCollector:
    """Hacker News top stories collector。"""

    async def collect(self, config: dict[str, Any]) -> list[RawCollectorItem]:
        limit = config.get("limit", DEFAULT_LIMIT)
        return await _collect_async(limit=limit)


# 向后兼容：旧代码可能还在用这个同步函数
def fetch_top_stories(limit: int = DEFAULT_LIMIT) -> list[dict[str, Any]]:
    """同步入口（兼容旧 push.py 如果还有引用）。"""
    items = asyncio.run(_collect_async(limit=limit))
    return [
        {
            "id": it["raw_payload"].get("hn_id"),
            "title": it["title"],
            "url": it["url"],
            "score": it["raw_payload"].get("score", 0),
            "by": it["raw_payload"].get("by", ""),
            "time": it["raw_payload"].get("time", 0),
        }
        for it in items
    ]
