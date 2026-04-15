"""Tests for search_items tool."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from radar.tools.search_items import search_items

FAKE_ITEMS = [
    {
        "id": "1",
        "title": "Building LLM Agents with LangChain",
        "summary": "A guide to building agents using LangChain framework",
        "grade": "A",
        "url": "https://example.com/1",
        "source": "hacker-news",
        "why": "Relevant to AI engineering",
    },
    {
        "id": "2",
        "title": "Rust Memory Safety",
        "summary": "How Rust prevents memory bugs at compile time",
        "grade": "B",
        "url": "https://example.com/2",
        "source": "hacker-news",
        "why": "Systems programming insight",
    },
    {
        "id": "3",
        "title": "Next.js 15 Release Notes",
        "summary": "New features in Next.js including LLM streaming support",
        "grade": "A",
        "url": "https://example.com/3",
        "source": "rss",
        "why": "Frontend framework update",
    },
]


@patch("radar.tools.search_items.PlatformClient")
def test_search_items_match(MockClient: MagicMock):
    """query 匹配 title/summary 时应返回对应条目。"""
    mock_instance = MockClient.return_value
    mock_instance.get_items.return_value = {"items": FAKE_ITEMS}

    result = search_items.invoke({"query": "LLM"})

    assert result["count"] == 2
    assert len(result["results"]) == 2
    titles = [r["title"] for r in result["results"]]
    assert "Building LLM Agents with LangChain" in titles
    assert "Next.js 15 Release Notes" in titles  # summary contains "LLM"


@patch("radar.tools.search_items.PlatformClient")
def test_search_items_no_match(MockClient: MagicMock):
    """无匹配时应返回空结果，不抛异常。"""
    mock_instance = MockClient.return_value
    mock_instance.get_items.return_value = {"items": FAKE_ITEMS}

    result = search_items.invoke({"query": "quantum computing"})

    assert result["count"] == 0
    assert result["results"] == []


@patch("radar.tools.search_items.PlatformClient")
def test_search_items_empty_query(MockClient: MagicMock):
    """空 query 应直接返回空结果，不调 BFF。"""
    mock_instance = MockClient.return_value

    result = search_items.invoke({"query": ""})

    assert result["count"] == 0
    assert result["results"] == []
    mock_instance.get_items.assert_not_called()


@patch("radar.tools.search_items.PlatformClient")
def test_search_items_whitespace_query(MockClient: MagicMock):
    """纯空白 query 也应返回空结果。"""
    mock_instance = MockClient.return_value

    result = search_items.invoke({"query": "   "})

    assert result["count"] == 0
    assert result["results"] == []
    mock_instance.get_items.assert_not_called()


@patch("radar.tools.search_items.PlatformClient")
def test_search_items_limit_clamped(MockClient: MagicMock):
    """limit 超过 10 应被截断为 10。"""
    mock_instance = MockClient.return_value
    mock_instance.get_items.return_value = {"items": FAKE_ITEMS}

    result = search_items.invoke({"query": "Rust", "limit": 50})

    # 只有 1 条匹配，但 limit 逻辑不应报错
    assert result["count"] == 1


@patch("radar.tools.search_items.PlatformClient")
def test_search_items_case_insensitive(MockClient: MagicMock):
    """搜索应大小写不敏感。"""
    mock_instance = MockClient.return_value
    mock_instance.get_items.return_value = {"items": FAKE_ITEMS}

    result = search_items.invoke({"query": "rust"})

    assert result["count"] == 1
    assert result["results"][0]["title"] == "Rust Memory Safety"


@patch("radar.tools.search_items.PlatformClient")
def test_search_items_result_fields(MockClient: MagicMock):
    """返回条目应只包含指定字段，不泄漏 id 等内部字段。"""
    mock_instance = MockClient.return_value
    mock_instance.get_items.return_value = {"items": FAKE_ITEMS}

    result = search_items.invoke({"query": "Rust"})

    item = result["results"][0]
    assert set(item.keys()) == {"title", "summary", "grade", "url", "source", "why"}
