"""Evaluate tool: LangChain @tool wrapper around the evaluate pipeline.

Reads pending raw_items via PlatformClient, runs LLM evaluation
(generate_recommendations), writes promoted items back, and updates
raw_item statuses. Returns a summary dict — never raises.
"""

from __future__ import annotations

import asyncio
import json
import time
from datetime import UTC, datetime
from typing import Annotated, Any

from agent_lab_shared.db import PlatformClient
from agent_lab_shared.exceptions import PlatformAPIError
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import InjectedToolArg, tool

from ..chains.recommend import generate_recommendations
from ..exceptions import EvaluationError


def _raw_items_to_stories(raw_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert raw_items from PlatformClient into the stories format
    expected by generate_recommendations."""
    stories: list[dict[str, Any]] = []
    for ri in raw_items:
        payload = ri.get("raw_payload", {})
        if isinstance(payload, str):
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
    return stories


def _run_evaluate_sync(
    agent_id: str,
    user_prompt: str | None,
) -> dict[str, Any]:
    """Synchronous core that mirrors evaluate pipeline logic.

    Steps:
      1. PlatformClient.get_raw_items(status="pending")
      2. Convert to stories
      3. generate_recommendations (LLM)
      4. PlatformClient.post_items_batch + update_raw_items_status
    """
    t0 = time.monotonic()
    client = PlatformClient()

    # 1. Fetch pending raw_items
    try:
        raw_items_resp = client.get_raw_items(agent_id=agent_id, status="pending")
        raw_items = raw_items_resp.get("raw_items", [])
    except PlatformAPIError as e:
        return {"error": f"fetch raw items failed: {e}"}

    if not raw_items:
        return {
            "evaluated": 0,
            "promoted": 0,
            "rejected": 0,
            "total_ms": 0.0,
            "preview": [],
        }

    # 2. Convert to stories
    stories = _raw_items_to_stories(raw_items)

    # 3. LLM evaluation (返 promoted ItemInputs + rejected [{external_id_suffix, reason}])
    try:
        items, rejected_list = generate_recommendations(stories, user_prompt)
    except EvaluationError as e:
        return {"error": f"llm evaluation failed: {e}"}

    # 4. Persist promoted items
    promoted_suffixes = set()
    for i in items:
        parts = i.external_id.split("-")
        if len(parts) >= 3:
            promoted_suffixes.add(parts[1])
        else:
            promoted_suffixes.add(i.external_id)

    if items:
        try:
            client.post_items_batch(datetime.now(UTC), items)
        except PlatformAPIError as e:
            return {"error": f"persist items failed: {e}"}

    # 5. Update raw_items statuses
    promoted_ids: list[str] = []
    rejected_ids: list[str] = []
    # 构造 external_id → reason 映射 (供 rejected preview 用)
    reason_by_ext: dict[str, str] = {r["external_id_suffix"]: r["reason"] for r in rejected_list}
    for ri in raw_items:
        if ri.get("external_id") in promoted_suffixes:
            promoted_ids.append(ri["id"])
        else:
            rejected_ids.append(ri["id"])

    try:
        if promoted_ids:
            client.update_raw_items_status(promoted_ids, "promoted")
        if rejected_ids:
            client.update_raw_items_status(rejected_ids, "rejected")
    except PlatformAPIError as e:
        return {"error": f"status update failed: {e}"}

    total_ms = round((time.monotonic() - t0) * 1000, 1)

    # 构造 rejected preview: 以 raw_items 里真实被 reject 的为准,
    # reason 从 LLM 给的 reason_by_ext 拿; 若 LLM 漏给 reason 则兜底占位.
    rejected_preview = []
    for ri in raw_items:
        ext_id = ri.get("external_id", "")
        if ext_id in promoted_suffixes:
            continue
        rejected_preview.append(
            {
                "title": ri.get("title", ""),
                "url": ri.get("url", ""),
                "reason": reason_by_ext.get(ext_id, "LLM 未提供理由"),
            }
        )

    return {
        "evaluated": len(raw_items),
        "promoted": len(promoted_ids),
        "rejected": len(rejected_ids),
        "total_ms": total_ms,
        "preview": {
            "promoted": [
                {"grade": i.grade, "title": i.title, "url": i.url, "why": i.why} for i in items
            ],
            "rejected": rejected_preview,
        },
    }


@tool
async def evaluate(
    agent_id: str = "radar",
    user_prompt: str | None = None,
    config: Annotated[RunnableConfig, InjectedToolArg] = None,  # type: ignore[assignment]
) -> dict[str, Any]:
    """Evaluate pending raw items using LLM and promote/reject them.

    Reads pending raw_items, asks LLM to score and filter, then writes
    promoted items back to the platform. Returns a summary with counts
    and a preview of promoted items.

    Args:
        agent_id: Agent identifier (default "radar").
        user_prompt: Optional custom system prompt for LLM evaluation.
            When provided, overrides the default evaluation prompt.
    """
    from copilotkit.langgraph import copilotkit_emit_state

    async def emit(step: str, **extra: Any) -> None:
        if config:
            try:
                await copilotkit_emit_state(config, {"progress": {"step": step, **extra}})
            except Exception:
                pass  # best-effort, don't break eval on emit failure

    try:
        await emit("fetching", total=0)
        result = await asyncio.to_thread(_run_evaluate_sync, agent_id, user_prompt)
        await emit(
            "done",
            evaluated=result.get("evaluated", 0),
            promoted=result.get("promoted", 0),
            total=result.get("evaluated", 0),
        )
        return result
    except Exception as e:
        return {"error": f"unexpected error: {e}"}
