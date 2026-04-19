"""Tests for recommendation chain."""

from radar.chains.recommend import (
    _parse_evaluation,
    _strip_code_fence,
    generate_recommendations,
)


def test_strip_code_fence_json():
    raw = '```json\n[{"a": 1}]\n```'
    assert _strip_code_fence(raw) == '[{"a": 1}]'


def test_strip_code_fence_bare():
    raw = '```\n[{"a": 1}]\n```'
    assert _strip_code_fence(raw) == '[{"a": 1}]'


def test_strip_code_fence_no_fence():
    raw = '[{"a": 1}]'
    assert _strip_code_fence(raw) == '[{"a": 1}]'


def test_parse_evaluation_new_format():
    """新格式: {promoted, rejected} object."""
    raw = """{
        "promoted": [
            {"external_id_suffix": "123", "grade": "fire", "title": "T",
             "summary": "S", "why": "W", "tags": ["a"], "url": "https://x.com"}
        ],
        "rejected": [
            {"external_id_suffix": "456", "reason": "偏商业, 非技术"}
        ]
    }"""
    result = _parse_evaluation(raw)
    assert len(result.promoted) == 1
    assert result.promoted[0].grade == "fire"
    assert result.promoted[0].title == "T"
    assert len(result.rejected) == 1
    assert result.rejected[0].external_id_suffix == "456"
    assert "商业" in result.rejected[0].reason


def test_parse_evaluation_legacy_bare_array_falls_back():
    """兼容旧格式: 裸 array 当 promoted, rejected 为空."""
    raw = (
        '[{"external_id_suffix": "1", "grade": "fire", "title": "T", '
        '"summary": "S", "why": "W", "tags": [], "url": "https://a.com"}]'
    )
    result = _parse_evaluation(raw)
    assert len(result.promoted) == 1
    assert len(result.rejected) == 0


def test_parse_evaluation_wrapped_items_legacy():
    """兼容旧: {items: [...]}."""
    raw = (
        '{"items": [{"external_id_suffix": "456", "grade": "bolt", "title": "T2", '
        '"summary": "S2", "why": "W2", "tags": [], "url": "https://y.com"}]}'
    )
    result = _parse_evaluation(raw)
    assert len(result.promoted) == 1
    assert result.promoted[0].grade == "bolt"


def test_parse_evaluation_skips_invalid_promoted():
    """坏的 promoted 条目跳过, 好的保留."""
    raw = """{
        "promoted": [
            {"external_id_suffix": "1", "grade": "fire", "title": "OK",
             "summary": "S", "why": "W", "tags": [], "url": "https://a.com"},
            {"bad": true}
        ],
        "rejected": []
    }"""
    result = _parse_evaluation(raw)
    assert len(result.promoted) == 1
    assert result.promoted[0].title == "OK"


def test_parse_evaluation_skips_invalid_rejected():
    """坏的 rejected 条目跳过."""
    raw = """{
        "promoted": [],
        "rejected": [
            {"external_id_suffix": "1", "reason": "偏商业"},
            {"no_reason": true}
        ]
    }"""
    result = _parse_evaluation(raw)
    assert len(result.rejected) == 1


def test_empty_stories_returns_empty_tuple():
    """空输入返 ([], [])."""
    items, rejected = generate_recommendations([])
    assert items == []
    assert rejected == []
