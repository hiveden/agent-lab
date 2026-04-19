"""Tests for PlatformClient.persist_chat + TracingLangGraphAGUIAgent persistence."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from agent_lab_shared.db import PlatformClient
from agent_lab_shared.exceptions import PlatformAPIError


def _mock_response(status_code: int, json: dict) -> httpx.Response:
    """Create a mock httpx.Response with a request set (needed for raise_for_status)."""
    resp = httpx.Response(status_code, json=json)
    resp.request = httpx.Request("POST", "http://127.0.0.1:8788/api/chat/persist")
    return resp


# ── PlatformClient.persist_chat ──


class TestPersistChat:
    """PlatformClient.persist_chat — httpx 层 mock 测试。"""

    def _make_client(self) -> PlatformClient:
        return PlatformClient(
            base_url="http://127.0.0.1:8788",
            token="test-token",
        )

    def test_persist_chat_success(self):
        """正常写入返回 ok。"""
        client = self._make_client()
        mock_resp = _mock_response(200, {"ok": True, "session_id": "sess-1"})
        with patch.object(httpx.Client, "post", return_value=mock_resp):
            result = client.persist_chat(
                thread_id="thread-abc",
                agent_id="radar",
                config_prompt="test prompt",
                result_summary={"evaluated": 10, "promoted": 2, "rejected": 8},
            )
        assert result["ok"] is True
        assert result["session_id"] == "sess-1"

    def test_persist_chat_sends_metadata_only_payload(self):
        """验证 POST body 只包含 session 元数据，不含 messages（Phase 2）。"""
        client = self._make_client()
        mock_resp = _mock_response(200, {"ok": True})
        with patch.object(httpx.Client, "post", return_value=mock_resp) as mock_post:
            client.persist_chat(
                thread_id="t-123",
                agent_id="radar",
                config_prompt="my config",
                result_summary={"evaluated": 5, "promoted": 1, "rejected": 4},
            )
            call_args = mock_post.call_args
            assert call_args[0][0] == "http://127.0.0.1:8788/api/chat/persist"
            payload = call_args[1]["json"]
            # Core: no messages field
            assert "messages" not in payload
            assert payload == {
                "agent_id": "radar",
                "thread_id": "t-123",
                "config_prompt": "my config",
                "result_summary": {"evaluated": 5, "promoted": 1, "rejected": 4},
            }
            headers = call_args[1]["headers"]
            assert headers["Authorization"] == "Bearer test-token"

    def test_persist_chat_omits_optional_fields_when_none(self):
        """config_prompt 或 result_summary 为 None 时不加入 payload。"""
        client = self._make_client()
        mock_resp = _mock_response(200, {"ok": True})
        with patch.object(httpx.Client, "post", return_value=mock_resp) as mock_post:
            client.persist_chat(thread_id="t-bare", agent_id="radar")
            payload = mock_post.call_args[1]["json"]
            assert payload == {"agent_id": "radar", "thread_id": "t-bare"}

    def test_persist_chat_http_error_raises(self):
        """BFF 返回 401 应抛 PlatformAPIError。"""
        client = self._make_client()
        mock_resp = _mock_response(401, {"error": "unauthorized"})
        with patch.object(httpx.Client, "post", return_value=mock_resp):
            with pytest.raises(PlatformAPIError) as exc_info:
                client.persist_chat(thread_id="t-bad", agent_id="radar")
            assert "401" in str(exc_info.value)

    def test_persist_chat_connection_error_raises(self):
        """网络不通应抛 PlatformAPIError。"""
        client = self._make_client()
        with patch.object(
            httpx.Client,
            "post",
            side_effect=httpx.ConnectError("connection refused"),
        ):
            with pytest.raises(PlatformAPIError):
                client.persist_chat(thread_id="t-fail", agent_id="radar")


# ── radar.observability.persist.persist_chat (Phase 5 #1 后拆为独立函数) ──


class TestPersistChatFunction:
    """persist_chat 独立函数 — mock graph + PlatformClient."""

    @pytest.mark.asyncio
    async def test_persist_chat_calls_platform_client(self):
        """Phase 2: persist_chat 只发 metadata, 不再传 messages 字段."""
        from radar.observability.persist import persist_chat

        mock_state = MagicMock()
        mock_state.values = {
            "messages": [
                SimpleNamespace(type="human", content="hello"),
                SimpleNamespace(type="ai", content="hi"),
            ],
        }
        graph = AsyncMock()
        graph.aget_state = AsyncMock(return_value=mock_state)

        with patch("agent_lab_shared.db.PlatformClient") as MockClient:
            mock_client = MockClient.return_value
            mock_client.persist_chat.return_value = {"ok": True}
            await persist_chat(graph, "thread-123", "radar")

            mock_client.persist_chat.assert_called_once()
            kwargs = mock_client.persist_chat.call_args.kwargs
            assert "messages" not in kwargs, "Phase 2: messages field should not be sent"
            assert kwargs["thread_id"] == "thread-123"
            assert kwargs["agent_id"] == "radar"
            # 本例无匹配的标志性消息 → None
            assert kwargs.get("config_prompt") is None
            assert kwargs.get("result_summary") is None

    @pytest.mark.asyncio
    async def test_persist_chat_no_messages_skips(self):
        """无 messages 时不调用 PlatformClient."""
        from radar.observability.persist import persist_chat

        mock_state = MagicMock()
        mock_state.values = {"messages": []}
        graph = AsyncMock()
        graph.aget_state = AsyncMock(return_value=mock_state)

        with patch("agent_lab_shared.db.PlatformClient") as MockClient:
            await persist_chat(graph, "thread-empty", "radar")
            MockClient.return_value.persist_chat.assert_not_called()

    @pytest.mark.asyncio
    async def test_persist_chat_failure_does_not_raise(self):
        """持久化失败不抛异常 (best-effort)."""
        from radar.observability.persist import persist_chat

        mock_state = MagicMock()
        mock_state.values = {
            "messages": [SimpleNamespace(type="human", content="hello")],
        }
        graph = AsyncMock()
        graph.aget_state = AsyncMock(return_value=mock_state)

        with patch("agent_lab_shared.db.PlatformClient") as MockClient:
            mock_client = MockClient.return_value
            mock_client.persist_chat.side_effect = Exception("network error")
            # Should NOT raise
            await persist_chat(graph, "thread-fail", "radar")
