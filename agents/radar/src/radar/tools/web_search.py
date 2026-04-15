"""Web search tool — Tavily Search API.

与 TS 版本 `apps/web/src/lib/tools/web-search.ts` 保持逻辑一致。
Free tier: 1000 queries/month.
"""

from __future__ import annotations

from typing import Any

import httpx
from langchain_core.tools import tool

from radar.collectors.base import proxy_kwargs


def _get_tavily_api_key() -> str:
    """从 Settings 或环境变量读取 TAVILY_API_KEY。"""
    from agent_lab_shared.config import settings

    return getattr(settings, "tavily_api_key", "") or ""


@tool
def web_search(query: str, max_results: int = 5) -> dict[str, Any]:
    """搜索互联网获取最新信息、对比分析、评测等。当用户问到实时数据、最新动态、对比不同方案时使用。

    Args:
        query: 搜索查询词
        max_results: 最大结果数，默认 5，上限 10
    """
    api_key = _get_tavily_api_key()
    if not api_key:
        return {"error": "搜索未配置：需要 TAVILY_API_KEY"}

    max_results = min(max_results, 10)

    try:
        with httpx.Client(timeout=20.0, trust_env=False, **proxy_kwargs()) as client:
            res = client.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": api_key,
                    "query": query,
                    "max_results": max_results,
                },
            )
    except httpx.HTTPError as exc:
        return {"error": f"Tavily API 请求失败: {exc}"}

    if res.status_code != 200:
        body = res.text[:200]
        return {"error": f"Tavily API 返回 {res.status_code}: {body}"}

    data = res.json()
    results = data.get("results") or []

    if not results:
        return {"results": [], "message": f'未找到 "{query}" 的搜索结果'}

    return {
        "results": [
            {
                "title": r.get("title", ""),
                "url": r.get("url", ""),
                "snippet": r.get("content", ""),
            }
            for r in results
        ],
    }
