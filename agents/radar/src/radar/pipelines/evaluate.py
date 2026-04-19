"""Evaluate pipeline: 从 raw_items 读取待评判内容，LLM 评分筛选，写入 items。

入口 `run_evaluate_stream()` 返回 AsyncIterator[ProgressEvent]。
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from datetime import UTC
from typing import Any

from agent_lab_shared.config import settings
from agent_lab_shared.db import PlatformClient
from agent_lab_shared.exceptions import PlatformAPIError

from ..chains.recommend import generate_recommendations
from ..exceptions import EvaluationError

ProgressEvent = dict[str, Any]


def _ev(payload: ProgressEvent) -> ProgressEvent:
    from datetime import datetime

    payload.setdefault("ts", datetime.now(UTC).isoformat())
    return payload


async def run_evaluate_stream(
    agent_id: str = "radar",
    user_prompt: str | None = None,
) -> AsyncIterator[ProgressEvent]:
    """读取 pending raw_items → LLM 评判 → 写入 items + 更新状态。"""
    t0 = time.monotonic()
    client = PlatformClient()

    # 创建 run 记录
    run_id = None
    try:
        run_result = client.create_run(agent_id=agent_id, phase="evaluate")
        run_id = run_result.get("run", {}).get("id") or run_result.get("id")
    except PlatformAPIError as e:
        yield _ev(
            {
                "type": "span",
                "id": "run-create",
                "kind": "system",
                "title": f"Failed to create run: {e}",
                "status": "failed",
            }
        )

    yield _ev(
        {
            "type": "start",
            "phase": "evaluate",
            "mock": False,
            "run_id": run_id,
        }
    )

    # 1. 获取 pending raw_items
    yield _ev(
        {
            "type": "span",
            "id": "fetch-raw",
            "kind": "system",
            "title": "Fetching pending raw items",
            "status": "running",
        }
    )
    t = time.monotonic()
    try:
        raw_items_resp = client.get_raw_items(agent_id=agent_id, status="pending")
        raw_items = raw_items_resp.get("raw_items", [])
    except PlatformAPIError as e:
        ms = int((time.monotonic() - t) * 1000)
        yield _ev(
            {
                "type": "span",
                "id": "fetch-raw",
                "kind": "system",
                "title": f"Failed: {e}",
                "status": "failed",
                "ms": ms,
            }
        )
        yield _ev({"type": "error", "message": f"fetch raw items failed: {e}"})
        return

    ms = int((time.monotonic() - t) * 1000)
    yield _ev(
        {
            "type": "span",
            "id": "fetch-raw",
            "kind": "system",
            "title": f"Got {len(raw_items)} pending items",
            "status": "done",
            "ms": ms,
        }
    )

    if not raw_items:
        yield _ev(
            {
                "type": "result",
                "phase": "evaluate",
                "evaluated": 0,
                "promoted": 0,
                "rejected": 0,
                "total_ms": 0,
            }
        )
        return

    # 2. 转为 recommend chain 需要的 stories 格式
    stories = []
    for ri in raw_items:
        payload = ri.get("raw_payload", {})
        if isinstance(payload, str):
            import json

            try:
                payload = json.loads(payload)
            except (json.JSONDecodeError, ValueError):
                payload = {}
        stories.append(
            {
                "id": ri.get("external_id", ""),
                "title": ri.get("title", ""),
                "url": ri.get("url", ""),
                "score": payload.get("score", 0),
                "by": payload.get("by", ""),
                "time": payload.get("time", 0),
            }
        )

    # 3. LLM 评判
    model_name = settings.llm_model_push

    # Build prompt preview (mirrors recommend.py logic)
    story_text = "\n".join(
        f"- id={s['id']} score={s.get('score', 0)} title={s['title']} url={s['url']}"
        for s in stories
    )
    prompt_preview = story_text[:200]

    yield _ev(
        {
            "type": "span",
            "id": "llm",
            "kind": "llm",
            "title": f"Asking {model_name} to evaluate {len(stories)} items",
            "status": "running",
            "detail": {
                "input_count": len(stories),
                "model": model_name,
                "prompt_preview": prompt_preview,
                "stories_count": len(stories),
            },
        }
    )
    t = time.monotonic()
    try:
        items, rejected_list = await asyncio.to_thread(
            generate_recommendations, stories, user_prompt
        )
    except EvaluationError as e:
        ms = int((time.monotonic() - t) * 1000)
        yield _ev(
            {
                "type": "span",
                "id": "llm",
                "kind": "llm",
                "title": f"LLM failed: {e}",
                "status": "failed",
                "ms": ms,
            }
        )
        yield _ev({"type": "error", "message": f"llm failed: {e}"})
        return

    ms = int((time.monotonic() - t) * 1000)
    yield _ev(
        {
            "type": "span",
            "id": "llm",
            "kind": "llm",
            "title": f"Selected {len(items)} recommendations",
            "status": "done",
            "ms": ms,
            "detail": {
                "count": len(items),
                "picks": [{"grade": i.grade, "title": i.title[:80]} for i in items],
            },
        }
    )

    # LLM response summary span
    response_preview = ", ".join(f"{i.grade}:{i.title[:60]}" for i in items)[:300]
    yield _ev(
        {
            "type": "span",
            "id": "llm-response",
            "kind": "llm",
            "title": f"LLM 返回 {len(items)} 条推荐",
            "status": "done",
            "ms": ms,
            "detail": {"response_preview": response_preview},
        }
    )

    # Per-item spans for promoted items
    for item in items:
        yield _ev(
            {
                "type": "span",
                "id": f"item-{item.external_id}",
                "kind": "system",
                "title": f"{item.grade} · {item.title}",
                "status": "done",
                "detail": {"why": item.why, "url": item.url},
            }
        )

    # 4. POST items to platform
    promoted_ext_ids = {i.external_id.split("-")[1] for i in items}  # hn-{id}-{date}

    if items:
        yield _ev(
            {
                "type": "span",
                "id": "persist",
                "kind": "system",
                "title": f"Saving {len(items)} curated items",
                "status": "running",
            }
        )
        t = time.monotonic()
        try:
            from datetime import datetime

            result = client.post_items_batch(datetime.now(UTC), items)
            inserted = result.get("inserted", 0)
            skipped = result.get("skipped", 0)
        except PlatformAPIError as e:
            ms = int((time.monotonic() - t) * 1000)
            yield _ev(
                {
                    "type": "span",
                    "id": "persist",
                    "kind": "system",
                    "title": f"Persist failed: {e}",
                    "status": "failed",
                    "ms": ms,
                }
            )
            yield _ev({"type": "error", "message": f"persist failed: {e}"})
            return

        ms = int((time.monotonic() - t) * 1000)
        yield _ev(
            {
                "type": "span",
                "id": "persist",
                "kind": "system",
                "title": f"Saved {inserted} new · {skipped} duplicate",
                "status": "done",
                "ms": ms,
            }
        )

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
    except PlatformAPIError as e:
        yield _ev(
            {
                "type": "span",
                "id": "status-update",
                "kind": "system",
                "title": f"Status update failed: {e}",
                "status": "failed",
            }
        )

    total_ms = int((time.monotonic() - t0) * 1000)

    # 更新 run
    if run_id:
        try:
            client.update_run(
                run_id,
                {
                    "status": "done",
                    "stats": {
                        "evaluated": len(raw_items),
                        "promoted": len(promoted_ids),
                        "rejected": len(rejected_ids),
                    },
                },
            )
        except PlatformAPIError:
            pass

    # 构造 rejected preview: 以 raw_items 里真实被 reject 的为准, reason 从 LLM 给的拿
    reason_by_ext: dict[str, str] = {r["external_id_suffix"]: r["reason"] for r in rejected_list}
    rejected_preview = []
    for ri in raw_items:
        if ri.get("external_id") in promoted_ext_ids:
            continue
        rejected_preview.append(
            {
                "title": ri.get("title", ""),
                "url": ri.get("url", ""),
                "reason": reason_by_ext.get(ri.get("external_id", ""), "LLM 未提供理由"),
            }
        )

    yield _ev(
        {
            "type": "result",
            "phase": "evaluate",
            "evaluated": len(raw_items),
            "promoted": len(promoted_ids),
            "rejected": len(rejected_ids),
            "total_ms": total_ms,
            "run_id": run_id,
            "preview": {
                "promoted": [
                    {"grade": i.grade, "title": i.title, "url": i.url, "why": i.why} for i in items
                ],
                "rejected": rejected_preview,
            },
        }
    )
