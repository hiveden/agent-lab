"""Radar LangGraph agent — ReAct agent with tool calling.

Factory function `create_radar_agent` returns a compiled LangGraph
StateGraph that can be used directly with AG-UI or invoked standalone.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, NotRequired

from agent_lab_shared.llm import DeferredLLM
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
    llm = DeferredLLM(task="chat")
    tools = get_all_tools()

    return create_react_agent(
        model=llm,
        tools=tools,
        prompt=system_prompt,
        name="radar_agent",
        state_schema=AgentState,
        checkpointer=checkpointer if checkpointer is not None else MemorySaver(),
    )
