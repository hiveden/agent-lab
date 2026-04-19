"""Observability 模块 — Phase 5 of docs/22 重构自 agui_tracing.py.

职责分离:
- tracer: 纯观测 (OTel current span → LangChain config + Langfuse callback)
- persist: run 结束后 chat 元数据持久化
- gen_ai_attrs: AG-UI event → OTel GenAI semconv attribute 映射 (预留)

#25 重构后 (ADR-011): repair 补丁层 (AGUIEventDedup) 已移除, DeferredLLM
架构根因已修, 事件流不再双发, 不需要补丁.

详见 docs/22-OBSERVABILITY-ENTERPRISE.md ADR-010 + ADR-011.
"""
