"""Radar LangGraph agent — ReAct agent with tool calling.

Factory function `create_radar_agent` returns a compiled LangGraph
StateGraph that can be used directly with AG-UI or invoked standalone.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, NotRequired

from agent_lab_shared.llm import get_llm
from copilotkit import CopilotKitState
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import MemorySaver
from langgraph.managed import RemainingSteps
from langgraph.prebuilt import create_react_agent

from .tools import get_all_tools

if TYPE_CHECKING:
    from langgraph.graph.state import CompiledStateGraph


class AgentState(CopilotKitState):
    """Radar agent state — inherits CopilotKit protocol fields."""

    remaining_steps: NotRequired[RemainingSteps]


DEFAULT_SYSTEM_PROMPT = (
    "你是 Radar Agent，一个智能信息发现助手。"
    "你可以搜索互联网、查询 GitHub 仓库统计、搜索已有推荐条目、"
    "以及评估待处理的原始内容。根据用户的问题选择合适的工具来回答。"
    "\n\n"
    "重要原则:\n"
    "1. 工具返回空结果时 (evaluated=0 / count=0 / 列表为空), **不要重试或换工具**, "
    "直接把情况告诉用户。\n"
    "2. 工具返回 message 字段时, 遵守它的指引。\n"
    "3. 同一个工具不要连续调用超过 2 次。完成任务就停, 不要无谓循环。"
)


def create_radar_agent(
    *,
    system_prompt: str = DEFAULT_SYSTEM_PROMPT,
    checkpointer: BaseCheckpointSaver | None = None,
) -> CompiledStateGraph:
    """Create and return a compiled ReAct agent for the Radar workflow.

    Args:
        system_prompt: The system prompt for the agent. Defaults to a
            Chinese-language Radar assistant prompt. Pass a custom string
            to override.
        checkpointer: LangGraph checkpointer instance. Defaults to
            MemorySaver (suitable for tests and CLI). Production server
            should inject AsyncSqliteSaver for persistence across
            process restarts.

    Returns:
        A compiled LangGraph StateGraph ready to be streamed or invoked.
    """
    # 缓存工厂: 首次构造后复用, Settings 改动时由 BFF 调 /internal/reload-llm 清缓存
    # 不再包装 BaseChatModel 避免 astream_events 双发 (见 docs/22 ADR-011)
    llm = get_llm("chat")
    tools = get_all_tools()

    return create_react_agent(
        model=llm,
        tools=tools,
        prompt=system_prompt,
        name="radar_agent",
        state_schema=AgentState,
        checkpointer=checkpointer if checkpointer is not None else MemorySaver(),
    )
