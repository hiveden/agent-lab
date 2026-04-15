"""Ingestion pipeline: 按 source 配置采集原始内容，写入 raw_items。

入口 `run_ingest_stream(sources)` 返回 AsyncIterator[ProgressEvent]。
不涉及 LLM，纯机械操作。
"""

from __future__ import annotations

import time
from collections.abc import AsyncIterator
from datetime import UTC
from typing import Any

from agent_lab_shared.db import PlatformClient
from agent_lab_shared.schema import SourceConfig

from ..collectors.base import get_collector

ProgressEvent = dict[str, Any]


def _ev(payload: ProgressEvent) -> ProgressEvent:
    """Helper: 加 ts 字段。"""
    from datetime import datetime

    payload.setdefault("ts", datetime.now(UTC).isoformat())
    return payload


async def run_ingest_stream(
    sources: list[SourceConfig],
) -> AsyncIterator[ProgressEvent]:
    """对每个 source 执行 collector，结果 POST 到 /api/raw-items/batch。

    Yields progress events 供 SSE 消费。
    """
    t0 = time.monotonic()
    client = PlatformClient()

    # 创建 run 记录
    run_id = None
    try:
        run_result = client.create_run(
            agent_id="radar",
            phase="ingest",
            source_ids=[s.id for s in sources],
        )
        run_id = run_result.get("run", {}).get("id") or run_result.get("id")
    except Exception as e:
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
            "phase": "ingest",
            "sources": [{"id": s.id, "type": s.source_type} for s in sources],
            "run_id": run_id,
        }
    )

    total_fetched = 0
    total_skipped = 0
    total_inserted = 0

    for src in sources:
        span_id = f"collect-{src.id}"
        yield _ev(
            {
                "type": "span",
                "id": span_id,
                "kind": "tool",
                "title": f"Collecting from {src.source_type} ({src.id})",
                "status": "running",
            }
        )
        t = time.monotonic()

        try:
            collector = get_collector(src.source_type)
            raw_items = await collector.collect(src.config)
        except Exception as e:
            ms = int((time.monotonic() - t) * 1000)
            yield _ev(
                {
                    "type": "span",
                    "id": span_id,
                    "kind": "tool",
                    "title": f"Collect failed: {e}",
                    "status": "failed",
                    "ms": ms,
                }
            )
            continue

        ms = int((time.monotonic() - t) * 1000)
        total_fetched += len(raw_items)
        yield _ev(
            {
                "type": "span",
                "id": span_id,
                "kind": "tool",
                "title": f"Fetched {len(raw_items)} items",
                "status": "done",
                "ms": ms,
                "detail": {
                    "count": len(raw_items),
                    "sample_titles": [it["title"][:80] for it in raw_items[:3]],
                },
            }
        )

        if not raw_items:
            continue

        # POST to /api/raw-items/batch
        persist_id = f"persist-{src.id}"
        yield _ev(
            {
                "type": "span",
                "id": persist_id,
                "kind": "system",
                "title": f"Saving {len(raw_items)} raw items",
                "status": "running",
            }
        )
        t = time.monotonic()
        try:
            batch_payload = [
                {
                    "source_id": src.id,
                    "agent_id": "radar",
                    "external_id": it["external_id"],
                    "title": it["title"],
                    "url": it.get("url"),
                    "raw_payload": it.get("raw_payload", {}),
                }
                for it in raw_items
            ]
            result = client.post_raw_items_batch(batch_payload, run_id=run_id)
            inserted = result.get("inserted", 0)
            skipped = result.get("skipped", 0)
            total_inserted += inserted
            total_skipped += skipped
        except Exception as e:
            ms = int((time.monotonic() - t) * 1000)
            yield _ev(
                {
                    "type": "span",
                    "id": persist_id,
                    "kind": "system",
                    "title": f"Persist failed: {e}",
                    "status": "failed",
                    "ms": ms,
                }
            )
            continue

        ms = int((time.monotonic() - t) * 1000)
        yield _ev(
            {
                "type": "span",
                "id": persist_id,
                "kind": "system",
                "title": f"Saved {inserted} new · {skipped} duplicate",
                "status": "done",
                "ms": ms,
            }
        )

    total_ms = int((time.monotonic() - t0) * 1000)

    # 更新 run 状态
    if run_id:
        try:
            client.update_run(
                run_id,
                {
                    "status": "done",
                    "stats": {
                        "fetched": total_fetched,
                        "inserted": total_inserted,
                        "skipped": total_skipped,
                    },
                },
            )
        except Exception:
            pass

    yield _ev(
        {
            "type": "result",
            "phase": "ingest",
            "fetched": total_fetched,
            "inserted": total_inserted,
            "skipped": total_skipped,
            "total_ms": total_ms,
            "run_id": run_id,
        }
    )
