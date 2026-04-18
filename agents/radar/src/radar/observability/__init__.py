"""Observability 模块 — Phase 5 of docs/22 重构自 agui_tracing.py.

职责分离:
- tracer: 纯观测 (OTel current span → LangChain config + Langfuse callback)
- repair: 补丁层 (上游 ag-ui-langgraph / DeferredLLM 的已知 bug), env flag 开关
- persist: run 结束后 chat 元数据持久化
- gen_ai_attrs: AG-UI event → OTel GenAI semconv attribute 映射 (预留)

详见 docs/22-OBSERVABILITY-ENTERPRISE.md ADR-010 "agui_tracing 重构".
"""
