"""AG-UI 事件去重 — 拦截 Ollama/本地模型产生的重复 START 事件。

ag-ui-langgraph adapter 在处理本地模型的 streaming chunks 时，
可能对同一个 ID 发射多次 START 事件（TOOL_CALL_START、TEXT_MESSAGE_START 等），
下游 AG-UI 状态机不允许未 END 就再 START，导致前端报错。

策略：统一追踪所有 START/END 配对，重复 START 和孤立 END 直接吞掉。
"""

from __future__ import annotations

from typing import Any

from ag_ui.core import EventType
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
    end_type: (start_type, id_field)
    for start_type, (end_type, id_field) in _PAIRED_EVENTS.items()
}


class TracingLangGraphAGUIAgent(LangGraphAGUIAgent):
    """去重 AG-UI START/END 配对事件，防止状态机报错。"""

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        # event_type → set of active IDs
        self._active: dict[EventType, set[str]] = {
            start_type: set() for start_type in _PAIRED_EVENTS
        }

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

        return super()._dispatch_event(event)
