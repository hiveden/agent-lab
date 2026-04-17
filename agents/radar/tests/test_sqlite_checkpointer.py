"""Phase 1 验证: AsyncSqliteSaver 作为 checkpointer 的累积与持久化行为。

对应 docs/20-LANGGRAPH-PERSISTENCE.md §8.3。
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path

import pytest
from langchain_core.messages import HumanMessage
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

# LLM 路径设为 mock，避免跑真 API
os.environ.setdefault("LLM_MOCK", "1")

from radar.agent import create_radar_agent  # noqa: E402


@pytest.fixture()
def tmp_db(tmp_path: Path) -> str:
    """每个测试用独立 SQLite 文件，避免互相污染。"""
    return str(tmp_path / "checkpoints.db")


@pytest.mark.asyncio
async def test_checkpointer_accumulates_without_duplication(tmp_db: str):
    """同 thread 多轮 invoke 后 messages 线性累积，不重复。"""
    async with AsyncSqliteSaver.from_conn_string(tmp_db) as saver:
        graph = create_radar_agent(checkpointer=saver)
        config = {"configurable": {"thread_id": f"test-accum-{uuid.uuid4()}"}}

        await graph.ainvoke({"messages": [HumanMessage("轮1")]}, config)
        state1 = await graph.aget_state(config)
        n1 = len(state1.values["messages"])

        await graph.ainvoke({"messages": [HumanMessage("轮2")]}, config)
        state2 = await graph.aget_state(config)
        n2 = len(state2.values["messages"])

        await graph.ainvoke({"messages": [HumanMessage("轮3")]}, config)
        state3 = await graph.aget_state(config)
        n3 = len(state3.values["messages"])

        # 每轮 +1 user +1 assistant (mock LLM 产生 1 条 ai 回复，无 tool call)
        # 核心断言：线性累积，不膨胀
        assert n2 - n1 == n3 - n2, (
            f"累积不线性！n1={n1}, n2={n2}, n3={n3}（说明存在膨胀）"
        )
        assert n3 > n2 > n1, f"消息数应单调递增, 得 n1={n1}, n2={n2}, n3={n3}"


@pytest.mark.asyncio
async def test_checkpointer_survives_instance_rebuild(tmp_db: str):
    """重建 agent 实例（模拟进程重启）后，同 thread_id 仍能读到历史 messages。

    验证 AsyncSqliteSaver 真正把 state 写入 SQLite 文件。
    """
    thread_id = f"test-restart-{uuid.uuid4()}"
    config = {"configurable": {"thread_id": thread_id}}

    # Instance 1 写入
    async with AsyncSqliteSaver.from_conn_string(tmp_db) as saver1:
        graph1 = create_radar_agent(checkpointer=saver1)
        await graph1.ainvoke({"messages": [HumanMessage("持久化测试")]}, config)
        state = await graph1.aget_state(config)
        count_before = len(state.values["messages"])
        assert count_before >= 2

    # Instance 2 读取（新 connection、新 graph，但同一个 SQLite 文件）
    async with AsyncSqliteSaver.from_conn_string(tmp_db) as saver2:
        graph2 = create_radar_agent(checkpointer=saver2)
        state = await graph2.aget_state(config)
        count_after = len(state.values["messages"])

    assert count_after == count_before, (
        f"重建后消息数应保持，得 before={count_before}, after={count_after}"
    )


@pytest.mark.asyncio
async def test_different_threads_isolated(tmp_db: str):
    """不同 thread_id 状态互相隔离。"""
    async with AsyncSqliteSaver.from_conn_string(tmp_db) as saver:
        graph = create_radar_agent(checkpointer=saver)
        config_a = {"configurable": {"thread_id": f"thread-a-{uuid.uuid4()}"}}
        config_b = {"configurable": {"thread_id": f"thread-b-{uuid.uuid4()}"}}

        await graph.ainvoke({"messages": [HumanMessage("A-轮1")]}, config_a)
        await graph.ainvoke({"messages": [HumanMessage("A-轮2")]}, config_a)
        await graph.ainvoke({"messages": [HumanMessage("B-只有一轮")]}, config_b)

        state_a = await graph.aget_state(config_a)
        state_b = await graph.aget_state(config_b)

        assert len(state_a.values["messages"]) > len(state_b.values["messages"]), (
            "thread A 应有更多消息（2 轮 vs 1 轮），说明 thread 状态隔离"
        )
