"""search_items tool — 搜索已评判 items，供 Agent 对话时使用。"""

from __future__ import annotations

from typing import Any

from agent_lab_shared.db import PlatformClient
from langchain_core.tools import tool


def _match(text: str | None, query_lower: str) -> bool:
    """Case-insensitive substring match."""
    if not text:
        return False
    return query_lower in text.lower()


@tool
def search_items(query: str, limit: int = 5) -> dict[str, Any]:
    """搜索已有的推荐条目数据库，查找相关或类似的内容。当用户问"还有类似的吗"、"相关推荐"时使用。

    Args:
        query: 搜索关键词
        limit: 返回条数上限，默认 5，最大 10
    """
    limit = max(1, min(limit, 10))

    if not query or not query.strip():
        return {"results": [], "count": 0}

    client = PlatformClient()
    # 从 BFF 拉取较多条目，客户端侧做文本过滤
    data = client.get_items(agent_id="radar", limit=200)
    all_items: list[dict[str, Any]] = data.get("items", [])

    query_lower = query.strip().lower()
    matched: list[dict[str, Any]] = []
    for item in all_items:
        if _match(item.get("title"), query_lower) or _match(item.get("summary"), query_lower):
            matched.append(
                {
                    "title": item.get("title", ""),
                    "summary": item.get("summary", ""),
                    "grade": item.get("grade", ""),
                    "url": item.get("url", ""),
                    "source": item.get("source", ""),
                    "why": item.get("why", ""),
                }
            )
            if len(matched) >= limit:
                break

    if not matched:
        return {"results": [], "count": 0}

    return {"results": matched, "count": len(matched)}
