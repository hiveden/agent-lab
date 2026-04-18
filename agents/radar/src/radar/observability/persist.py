"""Chat 持久化 — run 结束后 best-effort 写 session 元数据到 D1.

Messages 本身由 LangGraph AsyncSqliteSaver checkpointer 持久化 (见
docs/20-LANGGRAPH-PERSISTENCE.md), 本模块只写 session-level 元数据
(config_prompt + result_summary), 让 Agent sidebar 能显示 + 历史回顾。
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from agent_lab_shared.logging import get_logger

log = get_logger("radar.observability.persist")


# ── Extract helpers ────────────────────────────────────────────────


def extract_result_summary(messages: list[Any]) -> dict[str, int] | None:
    """从最后一次 evaluate tool call result 提 evaluated/promoted/rejected 计数."""
    # tool_call_id → tool_name 映射 (从 assistant messages)
    tc_id_to_name: dict[str, str] = {}
    for msg in messages:
        if getattr(msg, "type", None) != "ai":
            continue
        tool_calls = getattr(msg, "tool_calls", None) or []
        for tc in tool_calls:
            tc_id = tc.get("id", "")
            tc_name = tc.get("name", "")
            if tc_id and tc_name:
                tc_id_to_name[tc_id] = tc_name

    # 从 tool messages 找 evaluate 结果
    last_summary: dict[str, int] | None = None
    for msg in messages:
        if getattr(msg, "type", None) != "tool":
            continue
        tool_call_id = getattr(msg, "tool_call_id", None)
        if not tool_call_id or tc_id_to_name.get(tool_call_id) != "evaluate":
            continue
        content = getattr(msg, "content", "")
        if not content:
            continue
        try:
            data = json.loads(content) if isinstance(content, str) else content
            summary: dict[str, int] = {}
            for key in ("evaluated", "promoted", "rejected"):
                if key in data:
                    summary[key] = int(data[key])
            if summary:
                last_summary = summary
        except (json.JSONDecodeError, ValueError, TypeError):
            continue

    log.info(
        "extract_result_summary_ok" if last_summary else "extract_result_summary_none",
        summary=last_summary,
    )
    return last_summary


def extract_config_prompt(messages: list[Any]) -> str | None:
    """从 system message 提 ConfigCards 配置 prompt."""
    _CONFIG_KEYWORDS = ("核心使命", "推荐偏好", "过滤规则")

    for msg in messages:
        if getattr(msg, "type", None) != "system":
            continue
        content = getattr(msg, "content", "")
        if not content:
            continue
        if any(kw in content for kw in _CONFIG_KEYWORDS):
            log.info("extract_config_prompt_ok", length=len(content))
            return content

    log.info("extract_config_prompt_none")
    return None


# ── Persist ─────────────────────────────────────────────────────────


async def persist_chat(
    graph: Any,
    thread_id: str,
    agent_id: str,
) -> None:
    """Fire-and-forget: 把 session 元数据写 D1 (config_prompt + result_summary).

    Messages 本身在 LangGraph checkpointer 里, 本函数只写 session meta。
    """
    try:
        from agent_lab_shared.db import PlatformClient

        config = {"configurable": {"thread_id": thread_id}}
        state = await graph.aget_state(config)
        messages = state.values.get("messages", [])
        if not messages:
            log.info("persist_chat_skip", thread_id=thread_id, reason="no messages")
            return

        config_prompt = extract_config_prompt(messages)
        result_summary = extract_result_summary(messages)

        client = PlatformClient()
        await asyncio.to_thread(
            client.persist_chat,
            thread_id=thread_id,
            agent_id=agent_id,
            config_prompt=config_prompt,
            result_summary=result_summary,
        )
        log.info(
            "persist_chat_ok",
            thread_id=thread_id,
            has_config=config_prompt is not None,
            has_result=result_summary is not None,
        )
    except Exception:
        log.exception("persist_chat_failed", thread_id=thread_id)
