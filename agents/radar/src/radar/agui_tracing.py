"""Tracing + Persist 组合的 AG-UI Agent.

Phase 5 of docs/22 重构: 拆为 observability/ 下模块, 本文件只剩
薄壳 orchestration, 把它们按顺序组装到 LangGraphAGUIAgent 的生命周期。

#25 重构完成后 (ADR-011): 删 DeferredLLM 消除双发根因, repair 补丁层
(AGUIEventDedup) 随之移除, 事件流直接透传.

职责分离 (ADR-010 调整后):
- observability/tracer  - 纯观测, 不改事件
- observability/persist - chat meta 持久化
"""

from __future__ import annotations

import asyncio

from ag_ui.core import RunAgentInput
from copilotkit import LangGraphAGUIAgent

from .observability.persist import persist_chat
from .observability.tracer import inject_trace_context


class TracingLangGraphAGUIAgent(LangGraphAGUIAgent):
    """LangGraphAGUIAgent 的 observability 扩展.

    在 run() 里:
    0. 注入 OTel trace_id + Langfuse callback 到 LangChain config (tracer)
    1. run 结束后 fire-and-forget 持久化 chat 元数据 (persist)

    endpoint.py 每请求 clone 一个 agent 实例, self.config per-request 隔离.
    """

    async def run(self, input: RunAgentInput):  # type: ignore[override]
        self.config = inject_trace_context(self.config)

        thread_id = input.thread_id
        async for event in super().run(input):
            if event is not None:
                yield event

        if thread_id:
            asyncio.create_task(persist_chat(self.graph, thread_id, self.name))
