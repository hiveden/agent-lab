"""RSS/Atom Collector — feedparser 驱动。"""

from __future__ import annotations

from typing import Any

import feedparser
import httpx

from .base import RawCollectorItem, proxy_kwargs


class RssCollector:
    """RSS/Atom feed collector。"""

    async def collect(self, config: dict[str, Any]) -> list[RawCollectorItem]:
        feed_url = config.get("feed_url")
        if not feed_url:
            raise ValueError("RssCollector config missing 'feed_url'")

        limit = config.get("limit", 20)

        client_kwargs: dict[str, Any] = {"timeout": 20.0, "trust_env": False, **proxy_kwargs()}

        async with httpx.AsyncClient(**client_kwargs) as client:
            resp = await client.get(feed_url)
            resp.raise_for_status()
            text = resp.text

        feed = feedparser.parse(text)

        results: list[RawCollectorItem] = []
        for entry in feed.entries[:limit]:
            ext_id = entry.get("id") or entry.get("link") or entry.get("title", "")
            title = entry.get("title", "")
            url = entry.get("link")

            results.append(
                RawCollectorItem(
                    external_id=str(ext_id),
                    title=str(title),
                    url=str(url) if url else None,
                    raw_payload={
                        "published": entry.get("published", ""),
                        "summary": (entry.get("summary", "") or "")[:500],
                        "author": entry.get("author", ""),
                    },
                )
            )

        return results
