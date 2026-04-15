"""LLM factory: 按 task 返回 BaseChatModel。

读取优先级: platform API (DB settings) > env var > defaults

DeferredLLM: 延迟解析 LLM 配置的包装器，每次调用时才创建真实 LLM，
使得用户通过 Settings UI 修改配置后无需重启服务即可生效。
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Callable, Iterator, Sequence
from typing import Any, Literal

from langchain_core.callbacks import (
    AsyncCallbackManagerForLLMRun,
    CallbackManagerForLLMRun,
)
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import BaseMessage
from langchain_core.outputs import ChatGenerationChunk, ChatResult
from langchain_core.runnables import Runnable
from langchain_core.tools import BaseTool

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


def _create_llm(provider: str, base_url: str, api_key: str, model: str) -> BaseChatModel:
    """创建 LLM 实例。所有 provider 走 OpenAI-compatible API。"""
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


def get_llm(task: TaskType = "chat") -> BaseChatModel:
    """按任务类型返回 LLM。"""
    provider, base_url, api_key, model = _resolve_settings(task)
    return _create_llm(provider, base_url, api_key, model)


class DeferredLLM(BaseChatModel):
    """延迟解析的 LLM 包装器。

    不在构造时创建真实 LLM，而是在每次 _generate/_stream/_astream 调用时
    通过 get_llm(task) 创建新实例，从而始终读取最新的 LLM 配置。

    如果 bind_tools 被调用（如 create_react_agent 内部），返回一个新的
    DeferredLLM 实例，记住 tools 参数，在实际调用时应用。
    """

    task: TaskType = "chat"
    _bound_tools: list[Any] | None = None
    _bound_tool_choice: str | None = None
    _bound_tool_kwargs: dict[str, Any] = {}

    model_config = {"arbitrary_types_allowed": True}

    @property
    def _llm_type(self) -> str:
        return "deferred"

    def _get_runnable(self) -> BaseChatModel | Runnable:
        """创建新鲜的 LLM 实例，如果有 bound tools 则绑定。"""
        llm = get_llm(self.task)
        if self._bound_tools is not None:
            return llm.bind_tools(
                self._bound_tools,
                tool_choice=self._bound_tool_choice,
                **self._bound_tool_kwargs,
            )
        return llm

    def bind_tools(
        self,
        tools: Sequence[dict[str, Any] | type | Callable | BaseTool],
        *,
        tool_choice: str | None = None,
        **kwargs: Any,
    ) -> DeferredLLM:
        """记住 tools 参数，返回新的 DeferredLLM，实际绑定延迟到调用时。"""
        clone = DeferredLLM(task=self.task)
        clone._bound_tools = list(tools)
        clone._bound_tool_choice = tool_choice
        clone._bound_tool_kwargs = kwargs
        return clone

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        runnable = self._get_runnable()
        # 委托到真实 LLM 的 _generate（BaseChatModel 内部方法）
        if isinstance(runnable, BaseChatModel):
            return runnable._generate(messages, stop, run_manager, **kwargs)
        # bind_tools 返回的是 RunnableBinding，走 invoke
        result = runnable.invoke(messages, **kwargs)
        from langchain_core.outputs import ChatGeneration

        return ChatResult(generations=[ChatGeneration(message=result)])

    def _stream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> Iterator[ChatGenerationChunk]:
        runnable = self._get_runnable()
        if isinstance(runnable, BaseChatModel):
            yield from runnable._stream(messages, stop, run_manager, **kwargs)
            return
        # RunnableBinding — 走 stream
        for chunk in runnable.stream(messages, **kwargs):
            if isinstance(chunk, ChatGenerationChunk):
                yield chunk
            else:
                yield ChatGenerationChunk(message=chunk)

    async def _astream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: AsyncCallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[ChatGenerationChunk]:
        runnable = self._get_runnable()
        if isinstance(runnable, BaseChatModel):
            async for chunk in runnable._astream(messages, stop, run_manager, **kwargs):
                yield chunk
            return
        # RunnableBinding — 走 astream
        async for chunk in runnable.astream(messages, **kwargs):
            if isinstance(chunk, ChatGenerationChunk):
                yield chunk
            else:
                yield ChatGenerationChunk(message=chunk)
