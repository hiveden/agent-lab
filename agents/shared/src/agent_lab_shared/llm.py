"""LLM factory: 按 task 返回 BaseChatModel,支持 mock 模式。"""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from typing import Any, Literal

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage
from langchain_core.outputs import ChatGeneration, ChatGenerationChunk, ChatResult

from .config import settings

TaskType = Literal["push", "chat", "tool"]


class MockChatModel(BaseChatModel):
    """无依赖的假 LLM。固定输出 mock 回复,支持 stream 和 structured output。"""

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
        # 切成若干 chunk,模拟流式
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


def get_llm(task: TaskType = "chat") -> BaseChatModel:
    """按任务类型返回 LLM。LLM_MOCK=1 时返回 MockChatModel。

    明确传 trust_env=False 的 httpx client,避免 shell 的 HTTPS_PROXY/ALL_PROXY
    干扰本地 CPA / LLM provider 的 localhost 连接。
    """
    if settings.llm_mock:
        return MockChatModel()

    # 延迟导入,mock 模式下不需要真 openai 客户端
    import httpx
    from langchain_openai import ChatOpenAI

    if task == "push":
        model = settings.llm_model_push
    elif task == "tool":
        model = settings.llm_model_tool
    else:
        model = settings.llm_model_chat

    # 关键:trust_env=False 让 httpx 完全忽略 shell 的 HTTP_PROXY / HTTPS_PROXY /
    # ALL_PROXY / NO_PROXY,避免 localhost CPA 被推到 ClashX。
    sync_client = httpx.Client(trust_env=False, timeout=180.0)
    async_client = httpx.AsyncClient(trust_env=False, timeout=180.0)

    return ChatOpenAI(
        model=model,
        base_url=settings.glm_base_url,
        api_key=settings.glm_api_key or "sk-placeholder",
        temperature=0.7,
        http_client=sync_client,
        http_async_client=async_client,
    )
