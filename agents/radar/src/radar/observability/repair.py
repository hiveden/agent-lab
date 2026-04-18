"""补丁层 — AG-UI 事件去重, 修上游已知 bug.

⚠️ 这是 enforcement 层, 会吞掉事件, 与观测层严格分离 (详见 ADR-010).
按 env REPAIR_AGUI_DEDUP 启用 (默认 "1" = 开启, 保护前端不崩).
设 REPAIR_AGUI_DEDUP=0 可关闭, 让上游原始事件流直接暴露 (排查根因用).

修的 3 类 bug:

1. **重复 START 事件**: ag-ui-langgraph adapter 在处理 Ollama / 本地模型
   streaming chunks 时, 对同一个 ID 发射多次 TOOL_CALL_START /
   TEXT_MESSAGE_START。下游 AG-UI 状态机不允许未 END 就再 START。

2. **孤立 END 事件**: 上面吞掉 START 后对应 END 变成孤立, 再吞掉。

3. **CONTENT 连续重复**: DeferredLLM (BaseChatModel 子类包装器) 导致每个
   token 被 LangGraph astream_events 从 ChatOpenAI + DeferredLLM 各发一次,
   表现为连续两个 (message_id, delta) 完全相同的 TEXT_MESSAGE_CONTENT.
   丢弃第二个。

长期计划: 给 ag-ui-langgraph 提 upstream PR, 修好后删本模块 (docs/22 Phase 6).
"""

from __future__ import annotations

import os
from typing import Any

from ag_ui.core import EventType
from agent_lab_shared.logging import get_logger

log = get_logger("radar.observability.repair")

# START → END 配对映射, 以及各自 id 字段名
_PAIRED_EVENTS: dict[EventType, tuple[EventType, str]] = {
    EventType.TOOL_CALL_START: (EventType.TOOL_CALL_END, "tool_call_id"),
    EventType.TEXT_MESSAGE_START: (EventType.TEXT_MESSAGE_END, "message_id"),
}

# 反向: END → (START, id_field)
_END_TO_START: dict[EventType, tuple[EventType, str]] = {
    end_type: (start_type, id_field)
    for start_type, (end_type, id_field) in _PAIRED_EVENTS.items()
}


def repair_enabled() -> bool:
    """环境变量控制: REPAIR_AGUI_DEDUP=1 (默认开启) / =0 (关闭看根因)."""
    return os.environ.get("REPAIR_AGUI_DEDUP", "1") != "0"


class AGUIEventDedup:
    """3 层去重状态机. 每个请求一个实例 (endpoint.py clone agent 保证)."""

    def __init__(self) -> None:
        # event_type → set of active IDs
        self._active: dict[EventType, set[str]] = {
            start_type: set() for start_type in _PAIRED_EVENTS
        }
        # 上一个 CONTENT 事件的 (message_id, delta), 用于连续去重
        self._last_content: tuple[str | None, str | None] = (None, None)

    def filter(self, event: Any) -> Any:
        """过滤一个事件. 返回 event 本身或 None (表示丢弃).

        None 语义: 上层 dispatch 不调用 super._dispatch_event, 事件被吞。
        """
        event_type = getattr(event, "type", None)

        # ── START 事件: 检查重复 ──
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

        # ── END 事件: 检查孤立 ──
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
        elif event_type == EventType.TEXT_MESSAGE_CONTENT:
            key = (
                getattr(event, "message_id", None),
                getattr(event, "delta", None),
            )
            if key == self._last_content:
                self._last_content = (None, None)
                return None
            self._last_content = key

        return event
