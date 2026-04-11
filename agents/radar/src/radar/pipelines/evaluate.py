"""Evaluate pipeline: 从 raw_items 读取待评判内容，LLM 评分筛选，写入 items。

入口 `run_evaluate_stream()` 返回 AsyncIterator[ProgressEvent]。
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from typing import Any

from agent_lab_shared.config import settings
from agent_lab_shared.db import PlatformClient
from agent_lab_shared.schema import ItemInput
from agent_lab_shared.sse import progress_sse

from ..chains.recommend import generate_recommendations

ProgressEvent = dict[str, Any]


def _ev(payload: ProgressEvent) -> ProgressEvent:
    from datetime import datetime, timezone

    payload.setdefault("ts", datetime.now(timezone.utc).isoformat())
    return payload


async def run_evaluate_stream(
    agent_id: str = "radar",
) -> AsyncIterator[ProgressEvent]:
    """读取 pending raw_items → LLM 评判 → 写入 items + 更新状态。"""
    t0 = time.monotonic()
    client = PlatformClient()

    # 创建 run 记录
    run_id = None
    try:
        run_result = client.create_run(agent_id=agent_id, phase="evaluate")
        run_id = run_result.get("run", {}).get("id") or run_result.get("id")
    except Exception as e:
        yield _ev({"type": "span", "id": "run-create", "kind": "system",
                    "title": f"Failed to create run: {e}", "status": "failed"})

    yield _ev({
        "type": "start",
        "phase": "evaluate",
        "mock": settings.llm_mock,
        "run_id": run_id,
    })

    # 1. 获取 pending raw_items
    yield _ev({
        "type": "span", "id": "fetch-raw", "kind": "system",
        "title": "Fetching pending raw items",
        "status": "running",
    })
    t = time.monotonic()
    try:
        raw_items_resp = client.get_raw_items(agent_id=agent_id, status="pending")
        raw_items = raw_items_resp.get("raw_items", [])
    except Exception as e:
        ms = int((time.monotonic() - t) * 1000)
        yield _ev({
            "type": "span", "id": "fetch-raw", "kind": "system",
            "title": f"Failed: {e}", "status": "failed", "ms": ms,
        })
        yield _ev({"type": "error", "message": f"fetch raw items failed: {e}"})
        return

    ms = int((time.monotonic() - t) * 1000)
    yield _ev({
        "type": "span", "id": "fetch-raw", "kind": "system",
        "title": f"Got {len(raw_items)} pending items",
        "status": "done", "ms": ms,
    })

    if not raw_items:
        yield _ev({"type": "result", "phase": "evaluate",
                    "evaluated": 0, "promoted": 0, "rejected": 0, "total_ms": 0})
        return

    # 2. 转为 recommend chain 需要的 stories 格式
    stories = []
    for ri in raw_items:
        payload = ri.get("raw_payload", {})
        if isinstance(payload, str):
            import json
            try:
                payload = json.loads(payload)
            except Exception:
                payload = {}
        stories.append({
            "id": ri.get("external_id", ""),
            "title": ri.get("title", ""),
            "url": ri.get("url", ""),
            "score": payload.get("score", 0),
            "by": payload.get("by", ""),
            "time": payload.get("time", 0),
        })

    # 3. LLM 评判
    model_name = "mock" if settings.llm_mock else settings.llm_model_push
    yield _ev({
        "type": "span", "id": "llm", "kind": "llm",
        "title": f"Asking {model_name} to evaluate {len(stories)} items",
        "status": "running",
        "detail": {"input_count": len(stories), "model": model_name},
    })
    t = time.monotonic()
    try:
        items: list[ItemInput] = await asyncio.to_thread(
            generate_recommendations, stories
        )
    except Exception as e:
        ms = int((time.monotonic() - t) * 1000)
        yield _ev({
            "type": "span", "id": "llm", "kind": "llm",
            "title": f"LLM failed: {e}", "status": "failed", "ms": ms,
        })
        yield _ev({"type": "error", "message": f"llm failed: {e}"})
        return

    ms = int((time.monotonic() - t) * 1000)
    yield _ev({
        "type": "span", "id": "llm", "kind": "llm",
        "title": f"Selected {len(items)} recommendations",
        "status": "done", "ms": ms,
        "detail": {
            "count": len(items),
            "picks": [{"grade": i.grade, "title": i.title[:80]} for i in items],
        },
    })

    # 4. POST items to platform
    promoted_ext_ids = {i.external_id.split("-")[1] for i in items}  # hn-{id}-{date}

    if items:
        yield _ev({
            "type": "span", "id": "persist", "kind": "system",
            "title": f"Saving {len(items)} curated items",
            "status": "running",
        })
        t = time.monotonic()
        try:
            from datetime import datetime, timezone

            result = client.post_items_batch(datetime.now(timezone.utc), items)
            inserted = result.get("inserted", 0)
            skipped = result.get("skipped", 0)
        except Exception as e:
            ms = int((time.monotonic() - t) * 1000)
            yield _ev({
                "type": "span", "id": "persist", "kind": "system",
                "title": f"Persist failed: {e}", "status": "failed", "ms": ms,
            })
            yield _ev({"type": "error", "message": f"persist failed: {e}"})
            return

        ms = int((time.monotonic() - t) * 1000)
        yield _ev({
            "type": "span", "id": "persist", "kind": "system",
            "title": f"Saved {inserted} new · {skipped} duplicate",
            "status": "done", "ms": ms,
        })

    # 5. 更新 raw_items 状态
    promoted_ids = []
    rejected_ids = []
    for ri in raw_items:
        if ri.get("external_id") in promoted_ext_ids:
            promoted_ids.append(ri["id"])
        else:
            rejected_ids.append(ri["id"])

    try:
        if promoted_ids:
            client.update_raw_items_status(promoted_ids, "promoted")
        if rejected_ids:
            client.update_raw_items_status(rejected_ids, "rejected")
    except Exception as e:
        yield _ev({
            "type": "span", "id": "status-update", "kind": "system",
            "title": f"Status update failed: {e}", "status": "failed",
        })

    total_ms = int((time.monotonic() - t0) * 1000)

    # 更新 run
    if run_id:
        try:
            client.update_run(run_id, {
                "status": "done",
                "stats": {
                    "evaluated": len(raw_items),
                    "promoted": len(promoted_ids),
                    "rejected": len(rejected_ids),
                },
            })
        except Exception:
            pass

    yield _ev({
        "type": "result",
        "phase": "evaluate",
        "evaluated": len(raw_items),
        "promoted": len(promoted_ids),
        "rejected": len(rejected_ids),
        "total_ms": total_ms,
        "run_id": run_id,
        "preview": [
            {"grade": i.grade, "title": i.title, "url": i.url, "why": i.why}
            for i in items
        ],
    })
