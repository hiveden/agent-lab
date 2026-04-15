"""Tests for web_search tool."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import httpx

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_response(
    status_code: int = 200, json_data: dict | None = None, text: str = ""
) -> httpx.Response:
    """Build a fake httpx.Response."""
    import json as jsonlib

    request = httpx.Request("POST", "https://api.tavily.com/search")
    if json_data is not None:
        content = jsonlib.dumps(json_data).encode()
        return httpx.Response(
            status_code=status_code,
            content=content,
            request=request,
            headers={"content-type": "application/json"},
        )
    return httpx.Response(status_code=status_code, text=text, request=request)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestWebSearchTool:
    """web_search tool tests — all httpx calls are mocked."""

    def test_normal_results(self):
        """正常路径：Tavily 返回结果。"""
        fake_json = {
            "results": [
                {"title": "Foo", "url": "https://foo.com", "content": "Foo snippet", "score": 0.9},
                {"title": "Bar", "url": "https://bar.com", "content": "Bar snippet", "score": 0.8},
            ]
        }
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = _make_response(200, json_data=fake_json)

        with (
            patch("radar.tools.web_search._get_tavily_api_key", return_value="tvly-test-key"),
            patch("radar.tools.web_search.httpx.Client", return_value=mock_client),
        ):
            from radar.tools.web_search import web_search

            result = web_search.invoke({"query": "test query", "max_results": 5})

        assert "error" not in result
        assert len(result["results"]) == 2
        assert result["results"][0]["title"] == "Foo"
        assert result["results"][0]["url"] == "https://foo.com"
        assert result["results"][0]["snippet"] == "Foo snippet"
        assert result["results"][1]["title"] == "Bar"

    def test_empty_results(self):
        """空结果路径。"""
        fake_json = {"results": []}
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = _make_response(200, json_data=fake_json)

        with (
            patch("radar.tools.web_search._get_tavily_api_key", return_value="tvly-test-key"),
            patch("radar.tools.web_search.httpx.Client", return_value=mock_client),
        ):
            from radar.tools.web_search import web_search

            result = web_search.invoke({"query": "nothing here"})

        assert result["results"] == []
        assert "未找到" in result["message"]

    def test_no_api_key(self):
        """无 API key 返回 error dict，不抛异常。"""
        with patch("radar.tools.web_search._get_tavily_api_key", return_value=""):
            from radar.tools.web_search import web_search

            result = web_search.invoke({"query": "test"})

        assert "error" in result
        assert "TAVILY_API_KEY" in result["error"]

    def test_api_error_status(self):
        """API 返回非 200 状态码。"""
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = _make_response(429, text="Rate limit exceeded")

        with (
            patch("radar.tools.web_search._get_tavily_api_key", return_value="tvly-test-key"),
            patch("radar.tools.web_search.httpx.Client", return_value=mock_client),
        ):
            from radar.tools.web_search import web_search

            result = web_search.invoke({"query": "test"})

        assert "error" in result
        assert "429" in result["error"]

    def test_max_results_clamped_to_10(self):
        """max_results 超过 10 应被截断。"""
        fake_json = {
            "results": [{"title": "A", "url": "https://a.com", "content": "a", "score": 0.5}]
        }
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = _make_response(200, json_data=fake_json)

        with (
            patch("radar.tools.web_search._get_tavily_api_key", return_value="tvly-test-key"),
            patch("radar.tools.web_search.httpx.Client", return_value=mock_client),
        ):
            from radar.tools.web_search import web_search

            web_search.invoke({"query": "test", "max_results": 20})

        # Verify the POST was called with max_results capped at 10
        call_kwargs = mock_client.post.call_args
        assert call_kwargs[1]["json"]["max_results"] == 10

    def test_network_error(self):
        """网络错误返回 error dict，不抛异常。"""
        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.post.side_effect = httpx.ConnectError("Connection refused")

        with (
            patch("radar.tools.web_search._get_tavily_api_key", return_value="tvly-test-key"),
            patch("radar.tools.web_search.httpx.Client", return_value=mock_client),
        ):
            from radar.tools.web_search import web_search

            result = web_search.invoke({"query": "test"})

        assert "error" in result
        assert "请求失败" in result["error"]
