"""Tracing + Repair + Persist 组合的 AG-UI Agent.

Phase 5 of docs/22 重构: 拆为 observability/ 下 4 模块, 本文件只剩
薄壳 orchestration, 把它们按顺序组装到 LangGraphAGUIAgent 的生命周期。

职责分离 (ADR-010):
- observability/tracer  - 纯观测, 不改事件
- observability/repair  - 补丁层, 修上游 bug (env flag 开关)
- observability/persist - chat meta 持久化
"""

from __future__ import annotations

import asyncio
from typing import Any

from ag_ui.core import RunAgentInput
from agent_lab_shared.logging import get_logger
from copilotkit import LangGraphAGUIAgent

from .observability.persist import persist_chat
from .observability.repair import AGUIEventDedup, repair_enabled
from .observability.tracer import inject_trace_context

log = get_logger("radar.agui_tracing")


class TracingLangGraphAGUIAgent(LangGraphAGUIAgent):
    """LangGraphAGUIAgent 的 observability 扩展.

    在 run() 里:
    0. 注入 OTel trace_id + Langfuse callback 到 LangChain config (tracer)
    1. 按 env flag 过滤重复 / 孤立 AG-UI 事件 (repair)
    2. run 结束后 fire-and-forget 持久化 chat 元数据 (persist)

    endpoint.py 每请求 clone 一个 agent 实例, self.config / _dedup 状态
    per-request 隔离, 不跨请求污染。
    """

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._dedup: AGUIEventDedup | None = (
            AGUIEventDedup() if repair_enabled() else None
        )
        if self._dedup is None:
            log.info("repair_disabled_raw_events_through")

    def _dispatch_event(self, event: Any) -> Any:
        if self._dedup is not None:
            event = self._dedup.filter(event)
            if event is None:
                return None
        return super()._dispatch_event(event)

    async def run(self, input: RunAgentInput):  # type: ignore[override]
        self.config = inject_trace_context(self.config)

        thread_id = input.thread_id
        async for event in super().run(input):
            if event is not None:
                yield event

        if thread_id:
            asyncio.create_task(persist_chat(self.graph, thread_id, self.name))
