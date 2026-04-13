"""LLM factory: 按 task 返回 BaseChatModel，支持 mock + 多 provider。

读取优先级: platform API (DB settings) > env var > defaults
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from typing import Any, Literal

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult

from .config import settings

TaskType = Literal["push", "chat", "tool"]


class MockChatModel(BaseChatModel):
    """无依赖的假 LLM。固定输出 mock 回复。"""

    mock_text: str = "[mock] 这是一条假回复,Phase 2 接真 LLM。"

    @property
    def _llm_type(self) -> str:
        return "mock-chat"

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> ChatResult:
        msg = AIMessage(content=self.mock_text)
        return ChatResult(generations=[ChatGeneration(message=msg)])

    def _stream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> Iterator[ChatGenerationChunk]:
        text = self.mock_text
        size = max(1, len(text) // 6)
        for i in range(0, len(text), size):
            piece = text[i : i + size]
            yield ChatGenerationChunk(message=AIMessageChunk(content=piece))

    async def _astream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: Any = None,
        **kwargs: Any,
    ) -> AsyncIterator[ChatGenerationChunk]:
        for chunk in self._stream(messages, stop, run_manager, **kwargs):
            yield chunk


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
        if api_key:
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
    """按任务类型返回 LLM。LLM_MOCK=1 时返回 MockChatModel。"""
    if settings.llm_mock:
        return MockChatModel()

    provider, base_url, api_key, model = _resolve_settings(task)
    return _create_llm(provider, base_url, api_key, model)
