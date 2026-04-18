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
from uuid import UUID

from ag_ui.core import EventType, RunAgentInput
from agent_lab_shared.config import langfuse_enabled
from agent_lab_shared.logging import get_logger
from copilotkit import LangGraphAGUIAgent
from opentelemetry import trace

log = get_logger("radar.agui_tracing")


def _build_langfuse_callback() -> Any | None:
    """返回 Langfuse LangChain CallbackHandler 实例 (未启用时 None)。

    Phase 2 of docs/22 — LLM 专用 trace。Langfuse v4 SDK 自动从 env 读
    LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY / LANGFUSE_HOST。
    LangChain callback 接收的 run_id 已在 _inject_trace_context 设为 trace_id,
    所以 Langfuse trace 会按 trace_id 关联。
    """
    if not langfuse_enabled():
        return None
    try:
        from langfuse.langchain import CallbackHandler

        return CallbackHandler()
    except Exception as e:  # 装了 langfuse 但运行时失败 (网络/key) → 不阻塞主流程
        log.warning("langfuse_callback_init_failed", error=str(e))
        return None

# START → END 配对映射，以及各自用来取 ID 的字段名
_PAIRED_EVENTS: dict[EventType, tuple[EventType, str]] = {
    EventType.TOOL_CALL_START: (EventType.TOOL_CALL_END, "tool_call_id"),
    EventType.TEXT_MESSAGE_START: (EventType.TEXT_MESSAGE_END, "message_id"),
}

# 反向映射: END → (START, id_field)
_END_TO_START: dict[EventType, tuple[EventType, str]] = {
    end_type: (start_type, id_field) for start_type, (end_type, id_field) in _PAIRED_EVENTS.items()
}


def _extract_result_summary(messages: list[Any]) -> dict[str, int] | None:
    """Extract result summary from evaluate tool call results.

    Finds the last evaluate tool call result and extracts evaluated/promoted/rejected counts.
    """
    import json

    # Build tool_call_id → tool_name mapping from assistant messages
    tc_id_to_name: dict[str, str] = {}
    for msg in messages:
        role = getattr(msg, "type", None)
        if role != "ai":
            continue
        tool_calls = getattr(msg, "tool_calls", None)
        if not tool_calls:
            continue
        for tc in tool_calls:
            tc_id = tc.get("id", "")
            tc_name = tc.get("name", "")
            if tc_id and tc_name:
                tc_id_to_name[tc_id] = tc_name

    # Find tool messages whose tool_call_id maps to "evaluate"
    last_summary: dict[str, int] | None = None
    for msg in messages:
        role = getattr(msg, "type", None)
        if role != "tool":
            continue
        tool_call_id = getattr(msg, "tool_call_id", None)
        if not tool_call_id:
            continue
        if tc_id_to_name.get(tool_call_id) != "evaluate":
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

    if last_summary:
        log.info("extract_result_summary_ok", summary=last_summary)
    else:
        log.info("extract_result_summary_none")
    return last_summary


def _extract_config_prompt(messages: list[Any]) -> str | None:
    """Extract config prompt from system messages injected by useAgentContext.

    Looks for system messages containing ConfigCards keywords like
    '核心使命', '推荐偏好', or '过滤规则'.
    """
    _CONFIG_KEYWORDS = ("核心使命", "推荐偏好", "过滤规则")

    for msg in messages:
        role = getattr(msg, "type", None)
        if role != "system":
            continue
        content = getattr(msg, "content", "")
        if not content:
            continue
        if any(kw in content for kw in _CONFIG_KEYWORDS):
            log.info("extract_config_prompt_ok", length=len(content))
            return content

    log.info("extract_config_prompt_none")
    return None


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
        """Override run to: 0) inject OTel trace_id into LangGraph config,
        1) filter None events, 2) persist chat after completion.

        trace_id 注入逻辑见 docs/22-OBSERVABILITY-ENTERPRISE.md ADR-002a / Phase 1。
        OTel current span 由 FastAPIInstrumentor 从 traceparent header 自动建立。
        endpoint.py 每次请求 clone agent 实例 (line 23)，self.config 修改不会跨请求污染。
        """
        self._inject_trace_context()

        thread_id = input.thread_id
        async for event in super().run(input):
            if event is not None:
                yield event

        # Best-effort persistence — fire-and-forget, never block the response
        if thread_id:
            asyncio.create_task(self._persist_chat(thread_id))

    def _inject_trace_context(self) -> None:
        """从 OTel current span 提取 trace_id, 注入 LangChain config.run_id + Langfuse callback。

        LangChain 把 config['run_id'] 作为 root run tree id (LangSmith/Langfuse trace id)。
        让它 == OTel trace_id，使三段 (OTel / LangChain / AG-UI BaseEvent.runId) 对齐。

        同时注入 Langfuse CallbackHandler (Phase 2)，让 LangChain run tree 自动写
        Langfuse trace。callback 接收的 run_id 即 trace_id, Langfuse 自动按它关联。
        """
        span = trace.get_current_span()
        ctx = span.get_span_context()
        if not ctx.is_valid:
            log.debug("trace_context_skip", reason="no_valid_span")
            return

        trace_id_int = ctx.trace_id  # 128-bit
        trace_id_hex = format(trace_id_int, "032x")
        run_id = str(UUID(int=trace_id_int))

        existing = self.config or {}
        existing_metadata = (
            existing.get("metadata", {}) if isinstance(existing, dict) else {}
        )
        existing_callbacks = (
            list(existing.get("callbacks", []) or []) if isinstance(existing, dict) else []
        )

        # Phase 2: Langfuse LangChain callback (key 未配时返回 None, 静默跳过)
        langfuse_cb = _build_langfuse_callback()
        if langfuse_cb is not None:
            existing_callbacks.append(langfuse_cb)

        self.config = {
            **(existing if isinstance(existing, dict) else {}),
            "run_id": run_id,
            "metadata": {**existing_metadata, "trace_id": trace_id_hex},
            "callbacks": existing_callbacks,
        }
        log.info(
            "trace_context_injected",
            trace_id=trace_id_hex,
            run_id=run_id,
            langfuse=langfuse_cb is not None,
        )

    async def _persist_chat(self, thread_id: str) -> None:
        """Persist session-level metadata to D1 (config_prompt + result_summary).

        Messages themselves are persisted by LangGraph's AsyncSqliteSaver
        checkpointer — see docs/20-LANGGRAPH-PERSISTENCE.md. This method only
        writes session metadata to make sessions appear in the sidebar list
        and preserve the config/result snapshots for historical review.
        """
        try:
            from agent_lab_shared.db import PlatformClient

            config = {"configurable": {"thread_id": thread_id}}
            state = await self.graph.aget_state(config)
            messages = state.values.get("messages", [])
            if not messages:
                log.info("persist_chat_skip", thread_id=thread_id, reason="no messages")
                return

            config_prompt = _extract_config_prompt(messages)
            result_summary = _extract_result_summary(messages)

            client = PlatformClient()
            await asyncio.to_thread(
                client.persist_chat,
                thread_id=thread_id,
                agent_id=self.name,
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
