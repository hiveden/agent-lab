"""AG-UI event → OTel GenAI semantic convention attribute 映射.

Phase 5 / ADR-010 — 让 SigNoz / Langfuse / 任意 OTel backend 都能按标准字段
识别 LLM 维度的 trace (而不是依赖 Langfuse 特有的 traceloop.* attribute).

GenAI semconv 仍为 experimental (2026-04), 需要设
    OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental
参见 https://opentelemetry.io/docs/specs/semconv/gen-ai/

当前本模块为框架占位 (empty mapping), 未来扩展:
- TEXT_MESSAGE_START/CONTENT/END → gen_ai.completion span event
- TOOL_CALL_START/ARGS/END       → gen_ai.tool.* span attributes
- RUN_STARTED/FINISHED           → gen_ai.request.* + gen_ai.response.*

因为当前栈已通过 OpenLLMetry (traceloop-sdk) 自动产 LangChain span 含
所有需要的 attribute, 暂不需要在 AG-UI 层重复做。等未来有其他消费方
(比如非 LLM 的 agent framework) 再启用。
"""

from __future__ import annotations

from typing import Any

# GenAI semconv attribute keys (OpenTelemetry spec, v1.x experimental)
GEN_AI_SYSTEM = "gen_ai.system"
GEN_AI_OPERATION_NAME = "gen_ai.operation.name"
GEN_AI_REQUEST_MODEL = "gen_ai.request.model"
GEN_AI_RESPONSE_MODEL = "gen_ai.response.model"
GEN_AI_RESPONSE_FINISH_REASON = "gen_ai.response.finish_reasons"
GEN_AI_USAGE_INPUT_TOKENS = "gen_ai.usage.input_tokens"
GEN_AI_USAGE_OUTPUT_TOKENS = "gen_ai.usage.output_tokens"

# AG-UI agent framework identifier (应与 OpenLLMetry 对齐)
AGENT_FRAMEWORK = "ag-ui"


def agui_event_to_gen_ai_attrs(event: Any) -> dict[str, Any]:
    """AG-UI event → GenAI semconv attrs (占位, 当前返回空 dict).

    未来实现时参考:
    - https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/
    - https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-events/
    """
    return {}
