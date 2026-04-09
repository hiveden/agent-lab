"""Radar 推送流核心逻辑 (async generator + 进度事件流)。

入口 `run_push_stream(limit)` 返回 AsyncIterator[ProgressEvent],
cron.py / main.py (HTTP) 都消费它,确保 CLI / HTTP / 未来的调度器共享同一段逻辑。

进度事件 schema (和前端 trace span 对齐):
    {type:"span", id, kind, title, status:"running"|"done"|"failed",
     detail?: dict, ms?: int}
    {type:"result", inserted, skipped, total}
    {type:"error", message}
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from typing import Any

import httpx
from agent_lab_shared.config import settings
from agent_lab_shared.db import PlatformClient
from agent_lab_shared.schema import ItemInput

from .chains.recommend import generate_recommendations
from .collectors.hn import fetch_top_stories

ProgressEvent = dict[str, Any]


def _ev(payload: ProgressEvent) -> ProgressEvent:
    """Helper: 加 ts 字段。"""
    payload.setdefault("ts", datetime.now(timezone.utc).isoformat())
    return payload


async def run_push_stream(limit: int = 30) -> AsyncIterator[ProgressEvent]:
    """执行一次完整推送流,逐步 yield 进度事件。

    步骤:
      1. collect  — 拉 HN top stories
      2. llm      — 调用 LLM 生成推荐(或 mock)
      3. persist  — POST 到 Platform API
    """
    t0 = time.monotonic()

    # ── Start ──
    yield _ev({"type": "start", "limit": limit, "mock": settings.llm_mock})

    # ── Step 1: collect ──
    yield _ev(
        {
            "type": "span",
            "id": "collect",
            "kind": "tool",
            "title": f"Fetching top {limit} stories from Hacker News",
            "status": "running",
        }
    )
    t = time.monotonic()
    try:
        # fetch_top_stories 是同步 httpx,放到 thread pool
        stories = await asyncio.to_thread(fetch_top_stories, limit=limit)
    except Exception as e:  # noqa: BLE001
        yield _ev(
            {
                "type": "span",
                "id": "collect",
                "kind": "tool",
                "title": f"HN fetch failed: {e}",
                "status": "failed",
                "ms": int((time.monotonic() - t) * 1000),
            }
        )
        yield _ev({"type": "error", "message": f"collect failed: {e}"})
        return

    collect_ms = int((time.monotonic() - t) * 1000)
    yield _ev(
        {
            "type": "span",
            "id": "collect",
            "kind": "tool",
            "title": f"Fetched {len(stories)} stories with url",
            "status": "done",
            "detail": {
                "count": len(stories),
                "sample_titles": [s.get("title", "")[:80] for s in stories[:3]],
            },
            "ms": collect_ms,
        }
    )

    if not stories:
        yield _ev({"type": "result", "inserted": 0, "skipped": 0, "total": 0})
        return

    # ── Step 2: LLM → recommendations ──
    model_name = (
        "mock" if settings.llm_mock else settings.llm_model_push
    )
    yield _ev(
        {
            "type": "span",
            "id": "llm",
            "kind": "llm",
            "title": f"Asking {model_name} to select 3-5 recommendations",
            "status": "running",
            "detail": {"input_stories": len(stories), "model": model_name},
        }
    )
    t = time.monotonic()
    try:
        items: list[ItemInput] = await asyncio.to_thread(
            generate_recommendations, stories
        )
    except Exception as e:  # noqa: BLE001
        yield _ev(
            {
                "type": "span",
                "id": "llm",
                "kind": "llm",
                "title": f"LLM failed: {type(e).__name__}: {e}",
                "status": "failed",
                "ms": int((time.monotonic() - t) * 1000),
            }
        )
        yield _ev({"type": "error", "message": f"llm failed: {e}"})
        return

    llm_ms = int((time.monotonic() - t) * 1000)
    yield _ev(
        {
            "type": "span",
            "id": "llm",
            "kind": "llm",
            "title": f"Generated {len(items)} recommendations",
            "status": "done",
            "detail": {
                "count": len(items),
                "model": model_name,
                "picks": [
                    {"grade": i.grade, "title": i.title[:80]}
                    for i in items
                ],
            },
            "ms": llm_ms,
        }
    )

    if not items:
        yield _ev({"type": "result", "inserted": 0, "skipped": 0, "total": 0})
        return

    # ── Step 3: POST to Platform API ──
    yield _ev(
        {
            "type": "span",
            "id": "persist",
            "kind": "system",
            "title": f"POST {len(items)} items → {settings.platform_api_base}/api/items/batch",
            "status": "running",
        }
    )
    t = time.monotonic()
    round_at = datetime.now(timezone.utc)
    try:
        client = PlatformClient()
        result = await asyncio.to_thread(
            client.post_items_batch, round_at, items
        )
    except httpx.HTTPError as e:
        yield _ev(
            {
                "type": "span",
                "id": "persist",
                "kind": "system",
                "title": f"HTTP error: {e}",
                "status": "failed",
                "ms": int((time.monotonic() - t) * 1000),
            }
        )
        yield _ev({"type": "error", "message": f"persist failed: {e}"})
        return
    except Exception as e:  # noqa: BLE001
        yield _ev(
            {
                "type": "span",
                "id": "persist",
                "kind": "system",
                "title": f"Persist failed: {e}",
                "status": "failed",
                "ms": int((time.monotonic() - t) * 1000),
            }
        )
        yield _ev({"type": "error", "message": f"persist failed: {e}"})
        return

    persist_ms = int((time.monotonic() - t) * 1000)
    inserted = int(result.get("inserted", 0))
    skipped = int(result.get("skipped", 0))
    yield _ev(
        {
            "type": "span",
            "id": "persist",
            "kind": "system",
            "title": f"Saved {inserted} new · {skipped} duplicate",
            "status": "done",
            "detail": {"inserted": inserted, "skipped": skipped, "result": result},
            "ms": persist_ms,
        }
    )

    # ── Result ──
    total_ms = int((time.monotonic() - t0) * 1000)
    yield _ev(
        {
            "type": "result",
            "inserted": inserted,
            "skipped": skipped,
            "total": len(items),
            "total_ms": total_ms,
            "preview": [
                {
                    "grade": i.grade,
                    "title": i.title,
                    "url": i.url,
                    "why": i.why,
                }
                for i in items
            ],
        }
    )


def event_to_sse(ev: ProgressEvent) -> bytes:
    """把一个 ProgressEvent 序列化成一条 SSE data line。"""
    return f"data: {json.dumps(ev, ensure_ascii=False)}\n\n".encode("utf-8")
