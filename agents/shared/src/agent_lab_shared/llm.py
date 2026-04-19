"""LLM factory: 按 task 返回 ChatOpenAI 实例 (缓存 + push invalidation).

读取优先级: platform API (DB settings) > env var > defaults

热更新机制:
- 实例按 (task, provider, base_url, model, api_key hash) 缓存, 默认复用
- BFF 在 PUT /api/settings 成功后 POST /internal/reload-llm 主动清缓存
- 下一次 get_llm() 读最新配置重建实例 (<50ms 生效)

架构决策见 docs/22-OBSERVABILITY-ENTERPRISE.md ADR-011 + docs/28-DEFERRED-LLM-RESEARCH.md.
前版本用 DeferredLLM (BaseChatModel 子类包装器), 继承 BaseChatModel +
override _astream 导致 LangChain callback manager 把 wrapper 和 inner 各触发
一次 on_chat_model_stream, AG-UI 事件全部双发. 本版通过直接返回 ChatOpenAI
消除双层结构, 根治双发.
"""

from __future__ import annotations

import hashlib
import logging
from typing import Literal

from .config import settings

logger = logging.getLogger(__name__)

TaskType = Literal["push", "chat", "tool"]


def _resolve_settings(task: TaskType) -> tuple[str, str, str, str]:
    """解析 LLM 配置，返回 (provider, base_url, api_key, model)。

    优先级: platform API (DB settings) > env var > defaults
    """
    env_model_map = {
        "push": settings.llm_model_push,
        "chat": settings.llm_model_chat,
        "tool": settings.llm_model_tool,
    }

    # 优先从 platform API 读取 DB 配置
    try:
        from .db import PlatformClient

        client = PlatformClient()
        data = client.get_llm_settings()
        s = data.get("settings", {})

        api_key = s.get("api_key", "")
        db_provider = s.get("provider", "")
        # Ollama 不需要 API key，有 provider 就算有效配置
        if api_key or db_provider == "ollama":
            db_model_map = {
                "push": s.get("model_push", ""),
                "chat": s.get("model_chat", ""),
                "tool": s.get("model_tool", ""),
            }
            return (
                s.get("provider", settings.llm_provider),
                s.get("base_url", settings.glm_base_url),
                api_key,
                db_model_map.get(task, "") or env_model_map.get(task, ""),
            )
    except Exception:
        pass

    # Fallback: env var 配置
    return (
        settings.llm_provider,
        settings.glm_base_url,
        settings.glm_api_key,
        env_model_map.get(task, settings.llm_model_chat),
    )


def _create_llm(provider: str, base_url: str, api_key: str, model: str):
    """创建 ChatOpenAI 实例。所有 provider 走 OpenAI-compatible API."""
    import httpx
    from langchain_openai import ChatOpenAI

    sync_client = httpx.Client(trust_env=False, timeout=180.0)
    async_client = httpx.AsyncClient(trust_env=False, timeout=180.0)

    # Ollama 不需要 API key
    effective_key = api_key or ("ollama" if provider == "ollama" else "sk-placeholder")

    return ChatOpenAI(
        model=model,
        base_url=base_url,
        api_key=effective_key,
        temperature=0.7,
        http_client=sync_client,
        http_async_client=async_client,
    )


# 实例缓存: key = (task, provider, base_url, model, api_key hash)
# 单进程单用户场景够用; 多 worker 场景需要广播 invalidation (当前不做)
_cache: dict[str, object] = {}


def _cache_key(task: TaskType, provider: str, base_url: str, api_key: str, model: str) -> str:
    # api_key 用 sha256 前 16 char, 不泄露明文到日志
    key_hash = hashlib.sha256(api_key.encode()).hexdigest()[:16]
    return f"{task}:{provider}:{base_url}:{model}:{key_hash}"


def get_llm(task: TaskType = "chat"):
    """按任务类型返回 ChatOpenAI 实例 (缓存命中复用, miss 构造新).

    Returns:
        ChatOpenAI 实例. 不再包装 BaseChatModel 子类 (避免 astream_events 双发).
    """
    provider, base_url, api_key, model = _resolve_settings(task)
    key = _cache_key(task, provider, base_url, api_key, model)
    cached = _cache.get(key)
    if cached is None:
        cached = _create_llm(provider, base_url, api_key, model)
        _cache[key] = cached
        logger.info("llm_cache_miss", extra={"task": task, "provider": provider, "model": model})
    return cached


def invalidate_cache() -> None:
    """清空 LLM 实例缓存. 调用后下次 get_llm() 用最新配置重建.

    触发点:
    - BFF PUT /api/settings 成功后 POST /internal/reload-llm
    - 测试中重置状态
    """
    count = len(_cache)
    _cache.clear()
    logger.info("llm_cache_invalidated", extra={"cleared_count": count})
