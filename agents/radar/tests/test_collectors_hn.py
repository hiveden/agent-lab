"""Tests for HN collector."""

import pytest
from radar.collectors.base import get_collector
from radar.collectors.hn import HNCollector


def test_get_collector_hn():
    collector = get_collector("hacker-news")
    assert isinstance(collector, HNCollector)


def test_get_collector_unknown():
    with pytest.raises(ValueError, match="Unknown source_type"):
        get_collector("nonexistent")


@pytest.mark.asyncio
async def test_hn_collector_returns_raw_items(httpx_mock):
    """HN collector should return RawCollectorItem list."""
    # Mock HN API
    httpx_mock.add_response(
        url="https://hacker-news.firebaseio.com/v0/topstories.json",
        json=[1001, 1002, 1003],
    )
    httpx_mock.add_response(
        url="https://hacker-news.firebaseio.com/v0/item/1001.json",
        json={
            "id": 1001,
            "title": "Test Story 1",
            "url": "https://example.com/1",
            "score": 100,
            "by": "user1",
            "time": 1700000000,
        },
    )
    httpx_mock.add_response(
        url="https://hacker-news.firebaseio.com/v0/item/1002.json",
        json={
            "id": 1002,
            "title": "Test Story 2",
            "url": "https://example.com/2",
            "score": 50,
            "by": "user2",
            "time": 1700000001,
        },
    )
    # Item without URL (should be filtered)
    httpx_mock.add_response(
        url="https://hacker-news.firebaseio.com/v0/item/1003.json",
        json={
            "id": 1003,
            "title": "Ask HN: no url",
            "score": 30,
            "by": "user3",
            "time": 1700000002,
        },
    )

    collector = HNCollector()
    items = await collector.collect({"limit": 3})

    assert len(items) == 2  # item 1003 has no URL
    assert items[0]["external_id"] == "1001"
    assert items[0]["title"] == "Test Story 1"
    assert items[0]["url"] == "https://example.com/1"
    assert items[0]["raw_payload"]["score"] == 100


@pytest.mark.asyncio
async def test_hn_collector_handles_failed_items(httpx_mock):
    """Collector should skip items that fail to fetch."""
    httpx_mock.add_response(
        url="https://hacker-news.firebaseio.com/v0/topstories.json",
        json=[2001, 2002],
    )
    httpx_mock.add_response(
        url="https://hacker-news.firebaseio.com/v0/item/2001.json",
        json={
            "id": 2001,
            "title": "Good",
            "url": "https://good.com",
            "score": 10,
            "by": "u",
            "time": 0,
        },
    )
    httpx_mock.add_response(
        url="https://hacker-news.firebaseio.com/v0/item/2002.json",
        status_code=500,
    )

    collector = HNCollector()
    items = await collector.collect({"limit": 2})

    assert len(items) == 1
    assert items[0]["external_id"] == "2001"
