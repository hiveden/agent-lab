"""Chat chain: 流式对话,可选 item context 注入。"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from agent_lab_shared.llm import get_llm
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

_SYSTEM_BASE = (
    "你是 Radar,一个科技资讯策展 Agent,用中文回答用户。"
    "语气友好,回答简洁但有深度。"
)


def _build_messages(
    messages: list[dict[str, Any]], item: dict[str, Any] | None
) -> list[BaseMessage]:
    system_prompt = _SYSTEM_BASE
    if item:
        title = item.get("title", "")
        summary = item.get("summary", "")
        system_prompt += (
            f"\n\n用户正在问关于这条推荐:\n标题: {title}\n摘要: {summary}"
        )

    lc_messages: list[BaseMessage] = [SystemMessage(content=system_prompt)]
    for m in messages:
        role = m.get("role")
        content = m.get("content", "")
        if role == "user":
            lc_messages.append(HumanMessage(content=content))
        elif role == "assistant":
            lc_messages.append(AIMessage(content=content))
        elif role == "system":
            lc_messages.append(SystemMessage(content=content))
    return lc_messages


async def chat_stream(
    messages: list[dict[str, Any]], item: dict[str, Any] | None = None
) -> AsyncIterator[str]:
    """按 chunk 流式产出 LLM 文本。"""
    llm = get_llm("chat")
    lc_messages = _build_messages(messages, item)

    async for chunk in llm.astream(lc_messages):
        text = getattr(chunk, "content", None)
        if isinstance(text, str) and text:
            yield text
        elif isinstance(text, list):
            # 兼容部分 provider 返回 content parts
            for part in text:
                if isinstance(part, dict) and isinstance(part.get("text"), str):
                    yield part["text"]
