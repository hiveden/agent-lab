"""通用 HTTP Collector — 配置驱动，适用于任何返回 JSON 的 API。"""

from __future__ import annotations

import re
from typing import Any

import httpx

from .base import RawCollectorItem, proxy_kwargs


def _resolve_path(obj: Any, dotpath: str) -> Any:
    """按 dot notation 从嵌套 dict 取值。'content.title' → obj['content']['title']"""
    parts = dotpath.split(".")
    cur = obj
    for p in parts:
        if isinstance(cur, dict):
            cur = cur.get(p)
        else:
            return None
    return cur


def _render_template(template: str, item: dict[str, Any]) -> str:
    """替换 {dotpath} 占位符。'https://x/{content.id}' → 'https://x/123'"""

    def replacer(m: re.Match[str]) -> str:
        val = _resolve_path(item, m.group(1))
        return str(val) if val is not None else ""

    return re.sub(r"\{([^}]+)\}", replacer, template)


class HttpCollector:
    """通用 HTTP JSON API collector。"""

    async def collect(self, config: dict[str, Any]) -> list[RawCollectorItem]:
        url = config.get("url")
        if not url:
            raise ValueError("HttpCollector config missing 'url'")

        items_path = config.get("items_path")
        if not items_path:
            raise ValueError("HttpCollector config missing 'items_path'")

        mapping = config.get("mapping", {})
        if not mapping.get("external_id"):
            raise ValueError("HttpCollector config missing 'mapping.external_id'")

        method = config.get("method", "GET").upper()
        headers = config.get("headers", {})
        body = config.get("body")
        timeout = config.get("timeout", 20)
        limit = config.get("limit", 50)

        client_kwargs: dict[str, Any] = {
            "timeout": float(timeout),
            "trust_env": False,
            **proxy_kwargs(),
        }

        async with httpx.AsyncClient(**client_kwargs) as client:
            resp = await client.request(
                method, url, headers=headers, json=body if method == "POST" else None
            )
            resp.raise_for_status()
            data = resp.json()

        # 按 items_path 提取数组
        items_raw = _resolve_path(data, items_path)
        if not isinstance(items_raw, list):
            raise ValueError(f"items_path '{items_path}' did not resolve to a list")

        results: list[RawCollectorItem] = []
        for item in items_raw[:limit]:
            ext_id = _resolve_path(item, mapping["external_id"])
            if ext_id is None:
                continue

            title = _resolve_path(item, mapping.get("title", "title")) or ""

            # URL: 支持 url_template 或直接取值
            url_val = None
            if "url_template" in mapping:
                url_val = _render_template(mapping["url_template"], item)
            elif "url" in mapping:
                url_val = _resolve_path(item, mapping["url"])

            results.append(
                RawCollectorItem(
                    external_id=str(ext_id),
                    title=str(title),
                    url=str(url_val) if url_val else None,
                    raw_payload=item if isinstance(item, dict) else {"value": item},
                )
            )

        return results
