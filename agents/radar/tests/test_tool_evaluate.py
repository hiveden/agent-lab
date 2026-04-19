"""Tests for the evaluate tool."""

from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

from agent_lab_shared.exceptions import PlatformAPIError
from agent_lab_shared.schema import ItemInput
from radar.exceptions import EvaluationError
from radar.tools.evaluate import _raw_items_to_stories, _run_evaluate_sync, evaluate

# ── Fixtures ──


def _make_raw_items(n: int = 3) -> list[dict]:
    """Generate n fake raw_items as returned by PlatformClient.

    external_id uses plain numeric ids (like real HN story ids),
    matching the format expected by the pipeline's promoted_ext_ids logic:
      ItemInput.external_id = "hn-{hn_id}-{date}"
      promoted_ext_ids = {item.external_id.split("-")[1]}  → hn_id
      raw_item.external_id is compared against promoted_ext_ids
    """
    return [
        {
            "id": f"raw-{i}",
            "external_id": str(40000 + i),
            "title": f"Story {i}",
            "url": f"https://example.com/{i}",
            "raw_payload": {"score": 100 - i * 10, "by": f"user{i}", "time": 0},
            "status": "pending",
        }
        for i in range(n)
    ]


def _make_items(raw_items: list[dict], pick_count: int = 2) -> list[ItemInput]:
    """Generate ItemInput picks from raw_items (simulating LLM output).

    external_id format: hn-{hn_id}-{date} — matching generate_recommendations output.
    """
    now = datetime.now(UTC)
    return [
        ItemInput(
            external_id=f"hn-{ri['external_id']}-20260414",
            agent_id="radar",
            item_type="recommendation",
            grade="bolt",
            title=ri["title"],
            summary=f"Summary of {ri['title']}",
            why="Relevant to AI engineering",
            url=ri["url"],
            source="hacker-news",
            tags=["test"],
            payload={},
            round_at=now,
        )
        for ri in raw_items[:pick_count]
    ]


# ── Unit tests for _raw_items_to_stories ──


def test_raw_items_to_stories_normal():
    raw_items = _make_raw_items(2)
    stories = _raw_items_to_stories(raw_items)
    assert len(stories) == 2
    assert stories[0]["id"] == "40000"
    assert stories[0]["title"] == "Story 0"
    assert stories[0]["score"] == 100


def test_raw_items_to_stories_string_payload():
    """raw_payload as JSON string should be parsed."""
    raw_items = [
        {
            "id": "raw-x",
            "external_id": "ext-x",
            "title": "X",
            "url": "https://x.com",
            "raw_payload": '{"score": 42, "by": "alice"}',
        }
    ]
    stories = _raw_items_to_stories(raw_items)
    assert stories[0]["score"] == 42
    assert stories[0]["by"] == "alice"


def test_raw_items_to_stories_invalid_json_payload():
    """Invalid JSON string payload should fallback to empty dict."""
    raw_items = [
        {
            "id": "raw-y",
            "external_id": "ext-y",
            "title": "Y",
            "url": "https://y.com",
            "raw_payload": "not-json",
        }
    ]
    stories = _raw_items_to_stories(raw_items)
    assert stories[0]["score"] == 0
    assert stories[0]["by"] == ""


# ── Happy path: pending items → evaluate → result ──


@patch("radar.tools.evaluate.PlatformClient")
@patch("radar.tools.evaluate.generate_recommendations")
def test_evaluate_happy_path(mock_gen_rec, mock_client_cls):
    """Normal flow: fetch pending → LLM picks 2 → persist → update statuses."""
    raw_items = _make_raw_items(3)
    items = _make_items(raw_items, pick_count=2)

    client = MagicMock()
    mock_client_cls.return_value = client
    client.get_raw_items.return_value = {"raw_items": raw_items}
    client.post_items_batch.return_value = {"inserted": 2, "skipped": 0}
    client.update_raw_items_status.return_value = {"updated": 1}

    mock_gen_rec.return_value = (items, [])

    result = _run_evaluate_sync("radar", None)

    assert result["evaluated"] == 3
    assert result["promoted"] == 2
    assert result["rejected"] == 1
    assert result["total_ms"] >= 0
    # preview 新结构: {promoted: [...], rejected: [...]}
    assert "promoted" in result["preview"]
    assert "rejected" in result["preview"]
    assert len(result["preview"]["promoted"]) == 2
    assert result["preview"]["promoted"][0]["grade"] == "bolt"
    # rejected preview 应包含 raw_items 里未入选的那 1 条, 含 title+reason
    assert len(result["preview"]["rejected"]) == 1
    assert "title" in result["preview"]["rejected"][0]
    assert "reason" in result["preview"]["rejected"][0]

    # Verify pipeline calls
    client.get_raw_items.assert_called_once_with(agent_id="radar", status="pending")
    mock_gen_rec.assert_called_once()
    client.post_items_batch.assert_called_once()
    assert client.update_raw_items_status.call_count == 2  # promoted + rejected


# ── Empty path: no pending items ──


@patch("radar.tools.evaluate.PlatformClient")
def test_evaluate_no_pending_items(mock_client_cls):
    """No pending raw_items → return evaluated=0 immediately."""
    client = MagicMock()
    mock_client_cls.return_value = client
    client.get_raw_items.return_value = {"raw_items": []}

    result = _run_evaluate_sync("radar", None)

    assert result["evaluated"] == 0
    assert result["promoted"] == 0
    assert result["rejected"] == 0
    # preview 为统一 schema {promoted, rejected} (#2.8 后)
    assert result["preview"] == {"promoted": [], "rejected": []}
    # 显式 stop 指令防 LLM 死循环 (GraphRecursionError)
    assert "不要再调用" in result["message"]


# ── Error path: fetch raw items fails ──


@patch("radar.tools.evaluate.PlatformClient")
def test_evaluate_fetch_error(mock_client_cls):
    """PlatformClient.get_raw_items raises → return error dict."""
    client = MagicMock()
    mock_client_cls.return_value = client
    client.get_raw_items.side_effect = PlatformAPIError(
        "connection refused", url="/api/raw-items", method="GET"
    )

    result = _run_evaluate_sync("radar", None)

    assert "error" in result
    assert "fetch raw items failed" in result["error"]


# ── Error path: LLM fails ──


@patch("radar.tools.evaluate.PlatformClient")
@patch("radar.tools.evaluate.generate_recommendations")
def test_evaluate_llm_error(mock_gen_rec, mock_client_cls):
    """generate_recommendations raises → return error dict."""
    raw_items = _make_raw_items(2)

    client = MagicMock()
    mock_client_cls.return_value = client
    client.get_raw_items.return_value = {"raw_items": raw_items}

    mock_gen_rec.side_effect = EvaluationError("LLM returned non-JSON")

    result = _run_evaluate_sync("radar", None)

    assert "error" in result
    assert "llm evaluation failed" in result["error"]
    # Should NOT have tried to persist
    client.post_items_batch.assert_not_called()


# ── Error path: persist fails ──


@patch("radar.tools.evaluate.PlatformClient")
@patch("radar.tools.evaluate.generate_recommendations")
def test_evaluate_persist_error(mock_gen_rec, mock_client_cls):
    """post_items_batch fails → return error dict."""
    raw_items = _make_raw_items(2)
    items = _make_items(raw_items, pick_count=1)

    client = MagicMock()
    mock_client_cls.return_value = client
    client.get_raw_items.return_value = {"raw_items": raw_items}
    client.post_items_batch.side_effect = PlatformAPIError(
        "D1 write error", url="/api/items/batch", method="POST"
    )

    mock_gen_rec.return_value = (items, [])

    result = _run_evaluate_sync("radar", None)

    assert "error" in result
    assert "persist items failed" in result["error"]


# ── Error path: status update fails ──


@patch("radar.tools.evaluate.PlatformClient")
@patch("radar.tools.evaluate.generate_recommendations")
def test_evaluate_status_update_error(mock_gen_rec, mock_client_cls):
    """update_raw_items_status fails → return error dict."""
    raw_items = _make_raw_items(2)
    items = _make_items(raw_items, pick_count=1)

    client = MagicMock()
    mock_client_cls.return_value = client
    client.get_raw_items.return_value = {"raw_items": raw_items}
    client.post_items_batch.return_value = {"inserted": 1, "skipped": 0}
    client.update_raw_items_status.side_effect = PlatformAPIError(
        "batch-status 500", url="/api/raw-items/batch-status", method="PATCH"
    )

    mock_gen_rec.return_value = (items, [])

    result = _run_evaluate_sync("radar", None)

    assert "error" in result
    assert "status update failed" in result["error"]


# ── Async tool wrapper ──


@patch("radar.tools.evaluate.PlatformClient")
async def test_evaluate_tool_async(mock_client_cls):
    """The @tool async wrapper should delegate to _run_evaluate_sync."""
    client = MagicMock()
    mock_client_cls.return_value = client
    client.get_raw_items.return_value = {"raw_items": []}

    result = await evaluate.ainvoke({"agent_id": "radar"})

    assert result["evaluated"] == 0


# ── Custom user_prompt is forwarded ──


@patch("radar.tools.evaluate.PlatformClient")
@patch("radar.tools.evaluate.generate_recommendations")
def test_evaluate_custom_prompt(mock_gen_rec, mock_client_cls):
    """user_prompt should be forwarded to generate_recommendations."""
    raw_items = _make_raw_items(1)
    items = _make_items(raw_items, pick_count=1)

    client = MagicMock()
    mock_client_cls.return_value = client
    client.get_raw_items.return_value = {"raw_items": raw_items}
    client.post_items_batch.return_value = {"inserted": 1, "skipped": 0}
    client.update_raw_items_status.return_value = {"updated": 1}

    mock_gen_rec.return_value = (items, [])

    custom = "Focus only on Rust ecosystem news"
    _run_evaluate_sync("radar", custom)

    # generate_recommendations should receive the custom prompt
    call_args = mock_gen_rec.call_args
    assert call_args[0][1] == custom
