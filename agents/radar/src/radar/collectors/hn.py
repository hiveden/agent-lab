"""Hacker News top stories collector。HN 走直连,不走代理。"""

from __future__ import annotations

import asyncio
import os
from typing import Any

import httpx

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
    except Exception:
        return None


async def _collect_async(limit: int = DEFAULT_LIMIT) -> list[dict[str, Any]]:
    # 优先使用显式 HTTPS_PROXY (http://),避免 ALL_PROXY (socks5) 需要 socksio
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("HTTP_PROXY")
    client_kwargs: dict[str, Any] = {"timeout": 20.0, "trust_env": False}
    if proxy and proxy.startswith("http"):
        client_kwargs["proxy"] = proxy
    async with httpx.AsyncClient(**client_kwargs) as client:
        top_resp = await client.get(f"{HN_BASE}/topstories.json")
        top_resp.raise_for_status()
        ids: list[int] = top_resp.json()[:limit]

        raw = await asyncio.gather(*(_fetch_item(client, i) for i in ids))

    results: list[dict[str, Any]] = []
    for item in raw:
        if not item:
            continue
        if not item.get("url"):
            continue
        results.append(
            {
                "id": item.get("id"),
                "title": item.get("title", ""),
                "url": item.get("url"),
                "score": item.get("score", 0),
                "by": item.get("by", ""),
                "time": item.get("time", 0),
            }
        )
    return results


def fetch_top_stories(limit: int = DEFAULT_LIMIT) -> list[dict[str, Any]]:
    """同步入口,拉取 HN top stories 并过滤无 url 条目。"""
    return asyncio.run(_collect_async(limit=limit))
