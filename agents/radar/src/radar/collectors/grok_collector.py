"""Grok Collector — 通过 Grok API 的 x_search 工具采集 Twitter/X 推文。

参考: ~/projects/x-news-push/grok_client.py
特殊性: Grok 一步完成采集+过滤+摘要，返回结构化结果。
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from typing import Any

import httpx

from .base import RawCollectorItem

DEFAULT_API_URL = "https://api.apiyi.com/v1/responses"
DEFAULT_MODEL = "grok-4-fast-non-reasoning"
DEFAULT_BATCH_SIZE = 10


def _build_prompt(accounts: list[str], date: str) -> str:
    return f"""使用 x_search 工具搜索以下每个账号在 {date} 的推文。你必须实际调用 x_search 获取真实数据，不要凭记忆回答。

账号列表: {', '.join(accounts)}

搜索完成后，对结果执行：

1. 过滤：去掉纯回复（以@开头）、少于20字的推文、纯emoji推文
2. 分级：将剩余推文分为"值得关注"和"一般动态"两类
   - 值得关注：新模型/工具发布、重要技术观点、行业事件、论文、融资、政策
   - 一般动态：个人感想、转发评论、日常互动、使用体验
3. 对"值得关注"的每条，写中文摘要：2-3句话，不超过80字，只说事实和影响

以JSON返回，不要其他文字：
{{
  "highlights": [
    {{
      "handle": "账号名",
      "title": "10字以内标题",
      "summary": "不超过80字的中文摘要",
      "url": "推文链接",
      "posted_at": "发布时间"
    }}
  ],
  "skipped_count": 过滤掉的数量,
  "casual_count": 一般动态的数量
}}

如果搜索后确实没有新推文，返回空的 highlights 数组即可。"""


def _strip_code_fence(s: str) -> str:
    s = s.strip()
    m = re.match(r"^```(?:json)?\s*\n?(.*?)\n?```\s*$", s, re.DOTALL)
    if m:
        return m.group(1).strip()
    return s


async def _fetch_batch(
    client: httpx.AsyncClient,
    accounts: list[str],
    date: str,
    api_url: str,
    model: str,
    api_key: str,
) -> list[RawCollectorItem]:
    """调用 Grok API 采集一批账号的推文。"""
    payload = {
        "model": model,
        "input": [{"role": "user", "content": _build_prompt(accounts, date)}],
        "tools": [
            {
                "type": "x_search",
                "allowed_x_handles": accounts,
                "from_date": date,
            }
        ],
    }

    resp = await client.post(
        api_url,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        json=payload,
        timeout=120.0,
    )
    resp.raise_for_status()
    result = resp.json()

    # 反幻觉：验证 x_search 确实被调用
    usage = result.get("usage", {})
    tool_details = usage.get("server_side_tool_usage_details", {})
    x_search_calls = tool_details.get("x_search_calls", 0)
    if x_search_calls == 0:
        return []  # x_search 未被调用，不信任结果

    # 提取输出文本
    output_text = None
    for item in result.get("output", []):
        if item.get("type") == "message":
            for c in item.get("content", []):
                if c.get("type") == "output_text":
                    output_text = c.get("text", "")
                    break

    if not output_text:
        return []

    # 解析 JSON
    cleaned = _strip_code_fence(output_text)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        return []

    if not isinstance(data, dict):
        return []

    # 转为 RawCollectorItem
    items: list[RawCollectorItem] = []
    for h in data.get("highlights", []):
        handle = h.get("handle", "")
        items.append(
            RawCollectorItem(
                external_id=h.get("url", f"x-{handle}-{date}"),
                title=h.get("title", ""),
                url=h.get("url"),
                raw_payload={
                    "handle": handle,
                    "summary": h.get("summary", ""),
                    "posted_at": h.get("posted_at", ""),
                    "skipped_count": data.get("skipped_count", 0),
                    "casual_count": data.get("casual_count", 0),
                },
            )
        )

    return items


class GrokCollector:
    """通过 Grok API x_search 采集 Twitter/X 推文。"""

    async def collect(self, config: dict[str, Any]) -> list[RawCollectorItem]:
        accounts = config.get("accounts", [])
        if not accounts:
            raise ValueError("GrokCollector config missing 'accounts'")

        batch_size = config.get("batch_size", DEFAULT_BATCH_SIZE)
        api_url = config.get("api_url", DEFAULT_API_URL)
        model = config.get("model", DEFAULT_MODEL)
        date = config.get("date", datetime.now(timezone.utc).strftime("%Y-%m-%d"))

        # API key: env var > config
        api_key = os.environ.get("GROK_API_KEY", "") or config.get("api_key", "")
        if not api_key:
            raise ValueError("GROK_API_KEY env var or config.api_key required")

        # 分批（每批 ≤ batch_size）
        batches = [accounts[i:i + batch_size] for i in range(0, len(accounts), batch_size)]

        all_items: list[RawCollectorItem] = []
        async with httpx.AsyncClient(trust_env=False) as client:
            for batch in batches:
                items = await _fetch_batch(client, batch, date, api_url, model, api_key)
                all_items.extend(items)

        return all_items
