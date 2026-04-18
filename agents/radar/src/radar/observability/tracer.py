"""观测层 — 纯读 OTel current span, 注入到 LangChain config 让 Langfuse 关联.

纯观测, 不修改事件流。详见 docs/22 ADR-002c (Phase 3 修正) 与 ADR-010.

从 OTel current span 提 trace_id 写到 metadata (诊断用), 并附挂 Langfuse
LangChain callback 到 config["callbacks"] (Langfuse SDK 自己通过
OpenTelemetry context 关联 trace_id, 不需要应用代码强制覆盖 LangChain run_id).
"""

from __future__ import annotations

from typing import Any

from agent_lab_shared.config import langfuse_enabled
from agent_lab_shared.logging import get_logger
from opentelemetry import trace

log = get_logger("radar.observability.tracer")


def build_langfuse_callback() -> Any | None:
    """返回 Langfuse LangChain CallbackHandler 实例 (未启用时 None)."""
    if not langfuse_enabled():
        return None
    try:
        from langfuse.langchain import CallbackHandler

        return CallbackHandler()
    except Exception as e:
        log.warning("langfuse_callback_init_failed", error=str(e))
        return None


def inject_trace_context(base_config: dict[str, Any] | None) -> dict[str, Any]:
    """把 OTel current span trace_id 写入 metadata + 附挂 Langfuse callback.

    不覆盖 LangChain run_id (那是 ag-ui input.runId 来源, 强改破坏 ag-ui 协议).
    Phase 3 后 OTel trace_id 通过 W3C traceparent 由 BFF 自动 propagate.

    Parameters
    ----------
    base_config:
        LangGraphAGUIAgent.config (可能是 None / dict)

    Returns
    -------
    dict — 新 config (不 mutate 原 config), 调用方赋值回 agent.config.
    """
    existing = base_config or {}
    existing_metadata = (
        existing.get("metadata", {}) if isinstance(existing, dict) else {}
    )
    existing_callbacks = (
        list(existing.get("callbacks", []) or []) if isinstance(existing, dict) else []
    )

    span = trace.get_current_span()
    ctx = span.get_span_context()
    trace_id_hex = format(ctx.trace_id, "032x") if ctx.is_valid else None

    langfuse_cb = build_langfuse_callback()
    if langfuse_cb is not None:
        existing_callbacks.append(langfuse_cb)

    new_metadata = dict(existing_metadata)
    if trace_id_hex:
        new_metadata["trace_id"] = trace_id_hex

    log.info(
        "trace_context_injected",
        trace_id=trace_id_hex,
        langfuse=langfuse_cb is not None,
    )

    return {
        **(existing if isinstance(existing, dict) else {}),
        "metadata": new_metadata,
        "callbacks": existing_callbacks,
    }
