"""Tests for shared Pydantic schemas."""

import pytest
from agent_lab_shared.schema import (
    ItemInput,
    RawItemInput,
    SourceConfig,
)
from pydantic import ValidationError


def test_item_input_valid():
    item = ItemInput(
        external_id="test-1",
        agent_id="radar",
        item_type="recommendation",
        grade="fire",
        title="Test",
        summary="Summary",
        round_at="2026-01-01T00:00:00Z",
    )
    assert item.agent_id == "radar"


def test_item_input_invalid_grade():
    with pytest.raises(ValidationError):
        ItemInput(
            external_id="test-1",
            agent_id="radar",
            item_type="recommendation",
            grade="invalid",  # type: ignore
            title="Test",
            summary="Summary",
            round_at="2026-01-01T00:00:00Z",
        )


def test_raw_item_input():
    raw = RawItemInput(
        source_id="src_1",
        agent_id="radar",
        external_id="ext-1",
        title="Raw Title",
    )
    assert raw.url is None
    assert raw.raw_payload == {}


def test_source_config():
    sc = SourceConfig(id="src_hn", source_type="hacker-news", config={"limit": 30})
    assert sc.source_type == "hacker-news"
    assert sc.config["limit"] == 30
