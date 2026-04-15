"""AG-UI 事件去重 + 对话持久化。

去重：拦截 Ollama/本地模型产生的重复 START 事件。
ag-ui-langgraph adapter 在处理本地模型的 streaming chunks 时，
可能对同一个 ID 发射多次 START 事件（TOOL_CALL_START、TEXT_MESSAGE_START 等），
下游 AG-UI 状态机不允许未 END 就再 START，导致前端报错。
策略：统一追踪所有 START/END 配对，重复 START 和孤立 END 直接吞掉。

持久化：在 run() 结束后，将 agent state 中的 messages 通过
PlatformClient.persist_chat() 写入 D1，best-effort 不阻塞对话。
"""

from __future__ import annotations

import asyncio
from typing import Any

from ag_ui.core import EventType, RunAgentInput
from agent_lab_shared.logging import get_logger
from copilotkit import LangGraphAGUIAgent

log = get_logger("radar.agui_tracing")

# START → END 配对映射，以及各自用来取 ID 的字段名
_PAIRED_EVENTS: dict[EventType, tuple[EventType, str]] = {
    EventType.TOOL_CALL_START: (EventType.TOOL_CALL_END, "tool_call_id"),
    EventType.TEXT_MESSAGE_START: (EventType.TEXT_MESSAGE_END, "message_id"),
}

# 反向映射: END → (START, id_field)
_END_TO_START: dict[EventType, tuple[EventType, str]] = {
    end_type: (start_type, id_field) for start_type, (end_type, id_field) in _PAIRED_EVENTS.items()
}


def _langchain_messages_to_dicts(messages: list[Any]) -> list[dict[str, Any]]:
    """Convert LangChain BaseMessage list to serialisable dicts for persistence.

    Only keeps user/assistant/tool/system messages with non-empty content.
    """
    result: list[dict[str, Any]] = []
    for msg in messages:
        role = getattr(msg, "type", None)
        if role == "human":
            role = "user"
        elif role == "ai":
            role = "assistant"
        if role not in ("user", "assistant", "tool", "system"):
            continue
        content = getattr(msg, "content", "")
        if not content:
            continue
        entry: dict[str, Any] = {"role": role, "content": content}
        tool_calls = getattr(msg, "tool_calls", None)
        if tool_calls:
            entry["tool_calls"] = [
                {
                    "id": tc.get("id", ""),
                    "name": tc.get("name", ""),
                    "args": tc.get("args", {}),
                }
                for tc in tool_calls
            ]
        result.append(entry)
    return result


class TracingLangGraphAGUIAgent(LangGraphAGUIAgent):
    """去重 AG-UI 事件 + run 结束后 best-effort 持久化对话。

    去重两层:
    1. START/END 配对 — 重复 START 和孤立 END 直接吞掉
    2. CONTENT 连续去重 — DeferredLLM 包装器导致每个 token 从 ChatOpenAI 和
       DeferredLLM 各发一次，表现为连续两个相同 (message_id, delta) 事件。
       检测到连续重复时丢弃第二个。
    """

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        # event_type → set of active IDs
        self._active: dict[EventType, set[str]] = {
            start_type: set() for start_type in _PAIRED_EVENTS
        }
        # 上一个 CONTENT 事件的 (message_id, delta)，用于连续去重
        self._last_content: tuple[str | None, str | None] = (None, None)

    def _dispatch_event(self, event: Any) -> Any:
        event_type = getattr(event, "type", None)

        # ── START 事件：检查重复 ──
        if event_type in _PAIRED_EVENTS:
            _, id_field = _PAIRED_EVENTS[event_type]
            event_id = getattr(event, id_field, None)
            if event_id and event_id in self._active[event_type]:
                log.warning(
                    "duplicate_start_suppressed",
                    event_type=event_type.value,
                    event_id=event_id,
                )
                return None
            if event_id:
                self._active[event_type].add(event_id)

        # ── END 事件：检查孤立 ──
        elif event_type in _END_TO_START:
            start_type, id_field = _END_TO_START[event_type]
            event_id = getattr(event, id_field, None)
            if event_id and event_id not in self._active[start_type]:
                log.warning(
                    "orphaned_end_suppressed",
                    event_type=event_type.value,
                    event_id=event_id,
                )
                return None
            if event_id:
                self._active[start_type].discard(event_id)

        # ── CONTENT 连续去重 ──
        # DeferredLLM 包装器导致 ChatOpenAI 和 DeferredLLM 各发一次相同 delta，
        # 表现为连续两个 (message_id, delta) 完全相同的事件。丢弃第二个。
        elif event_type == EventType.TEXT_MESSAGE_CONTENT:
            key = (getattr(event, "message_id", None), getattr(event, "delta", None))
            if key == self._last_content:
                self._last_content = (None, None)
                return None
            self._last_content = key

        return super()._dispatch_event(event)

    # ── 对话持久化 ──

    async def run(self, input: RunAgentInput):  # type: ignore[override]
        """Override run to: 1) filter None events, 2) persist chat after completion."""
        thread_id = input.thread_id
        async for event in super().run(input):
            if event is not None:
                yield event

        # Best-effort persistence — fire-and-forget, never block the response
        if thread_id:
            asyncio.create_task(self._persist_chat(thread_id))

    async def _persist_chat(self, thread_id: str) -> None:
        """Extract messages from graph state and persist via PlatformClient."""
        try:
            from agent_lab_shared.db import PlatformClient

            config = {"configurable": {"thread_id": thread_id}}
            state = await self.graph.aget_state(config)
            messages = state.values.get("messages", [])
            if not messages:
                log.info("persist_chat_skip", thread_id=thread_id, reason="no messages")
                return

            dicts = _langchain_messages_to_dicts(messages)
            if not dicts:
                log.info("persist_chat_skip", thread_id=thread_id, reason="no persistable messages")
                return

            client = PlatformClient()
            await asyncio.to_thread(
                client.persist_chat,
                thread_id=thread_id,
                agent_id=self.name,
                messages=dicts,
            )
            log.info(
                "persist_chat_ok",
                thread_id=thread_id,
                message_count=len(dicts),
            )
        except Exception:
            log.exception("persist_chat_failed", thread_id=thread_id)
