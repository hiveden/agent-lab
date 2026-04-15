"""Tests for AG-UI event dedup tracing layer."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from ag_ui.core import EventType


def _make_event(event_type: EventType, **kwargs) -> SimpleNamespace:
    return SimpleNamespace(type=event_type, **kwargs)


@pytest.fixture()
def agent_and_log():
    mock_log = MagicMock()
    with (
        patch("radar.agui_tracing.LangGraphAGUIAgent.__init__", return_value=None),
        patch("radar.agui_tracing.log", mock_log),
    ):
        from radar.agui_tracing import TracingLangGraphAGUIAgent

        a = TracingLangGraphAGUIAgent()
        a._active = {
            EventType.TOOL_CALL_START: set(),
            EventType.TEXT_MESSAGE_START: set(),
        }
        yield a, mock_log


class TestNormalSequence:
    """START -> END 正常配对，两种事件类型。"""

    def test_tool_call_start_then_end(self, agent_and_log):
        agent, _ = agent_and_log
        with patch.object(type(agent).__bases__[0], "_dispatch_event", return_value="ok") as mock_super:
            start = _make_event(EventType.TOOL_CALL_START, tool_call_id="c1", tool_call_name="search")
            end = _make_event(EventType.TOOL_CALL_END, tool_call_id="c1")

            assert agent._dispatch_event(start) == "ok"
            assert agent._dispatch_event(end) == "ok"
            assert mock_super.call_count == 2
            assert "c1" not in agent._active[EventType.TOOL_CALL_START]

    def test_text_message_start_then_end(self, agent_and_log):
        agent, _ = agent_and_log
        with patch.object(type(agent).__bases__[0], "_dispatch_event", return_value="ok") as mock_super:
            start = _make_event(EventType.TEXT_MESSAGE_START, message_id="m1", role="assistant")
            end = _make_event(EventType.TEXT_MESSAGE_END, message_id="m1")

            assert agent._dispatch_event(start) == "ok"
            assert agent._dispatch_event(end) == "ok"
            assert mock_super.call_count == 2
            assert "m1" not in agent._active[EventType.TEXT_MESSAGE_START]


class TestDuplicateStart:
    """重复 START 被吞掉，返回 None。"""

    def test_duplicate_tool_call_start_suppressed(self, agent_and_log):
        agent, log = agent_and_log
        with patch.object(type(agent).__bases__[0], "_dispatch_event", return_value="ok") as mock_super:
            evt1 = _make_event(EventType.TOOL_CALL_START, tool_call_id="dup", tool_call_name="eval")
            evt2 = _make_event(EventType.TOOL_CALL_START, tool_call_id="dup", tool_call_name="eval")

            assert agent._dispatch_event(evt1) == "ok"
            assert agent._dispatch_event(evt2) is None  # suppressed

            assert mock_super.call_count == 1  # only first forwarded
            log.warning.assert_called_once()
            assert log.warning.call_args[0][0] == "duplicate_start_suppressed"

    def test_duplicate_text_message_start_suppressed(self, agent_and_log):
        agent, log = agent_and_log
        with patch.object(type(agent).__bases__[0], "_dispatch_event", return_value="ok") as mock_super:
            evt1 = _make_event(EventType.TEXT_MESSAGE_START, message_id="m_dup", role="assistant")
            evt2 = _make_event(EventType.TEXT_MESSAGE_START, message_id="m_dup", role="assistant")

            assert agent._dispatch_event(evt1) == "ok"
            assert agent._dispatch_event(evt2) is None

            assert mock_super.call_count == 1
            log.warning.assert_called_once()


class TestOrphanedEnd:
    """END 无匹配 START 被吞掉。"""

    def test_orphaned_tool_call_end_suppressed(self, agent_and_log):
        agent, log = agent_and_log
        with patch.object(type(agent).__bases__[0], "_dispatch_event", return_value="ok") as mock_super:
            evt = _make_event(EventType.TOOL_CALL_END, tool_call_id="orphan")

            assert agent._dispatch_event(evt) is None
            mock_super.assert_not_called()
            log.warning.assert_called_once()
            assert log.warning.call_args[0][0] == "orphaned_end_suppressed"

    def test_orphaned_text_message_end_suppressed(self, agent_and_log):
        agent, log = agent_and_log
        with patch.object(type(agent).__bases__[0], "_dispatch_event", return_value="ok") as mock_super:
            evt = _make_event(EventType.TEXT_MESSAGE_END, message_id="orphan_m")

            assert agent._dispatch_event(evt) is None
            mock_super.assert_not_called()


class TestPassthrough:
    """非 START/END 配对事件透传不受影响。"""

    def test_state_snapshot_passthrough(self, agent_and_log):
        agent, log = agent_and_log
        with patch.object(type(agent).__bases__[0], "_dispatch_event", return_value="snap") as mock_super:
            evt = _make_event(EventType.STATE_SNAPSHOT, snapshot={})
            assert agent._dispatch_event(evt) == "snap"
            mock_super.assert_called_once()
            log.warning.assert_not_called()

    def test_text_message_content_passthrough(self, agent_and_log):
        agent, _ = agent_and_log
        with patch.object(type(agent).__bases__[0], "_dispatch_event", return_value="ok") as mock_super:
            evt = _make_event(EventType.TEXT_MESSAGE_CONTENT, message_id="m1", delta="hello")
            assert agent._dispatch_event(evt) == "ok"
            mock_super.assert_called_once()
