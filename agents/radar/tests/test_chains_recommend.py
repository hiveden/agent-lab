"""Tests for recommendation chain."""

from radar.chains.recommend import generate_recommendations, _parse_recommendations, _strip_code_fence


def test_strip_code_fence_json():
    raw = '```json\n[{"a": 1}]\n```'
    assert _strip_code_fence(raw) == '[{"a": 1}]'


def test_strip_code_fence_bare():
    raw = '```\n[{"a": 1}]\n```'
    assert _strip_code_fence(raw) == '[{"a": 1}]'


def test_strip_code_fence_no_fence():
    raw = '[{"a": 1}]'
    assert _strip_code_fence(raw) == '[{"a": 1}]'


def test_parse_recommendations_valid():
    raw = '[{"external_id_suffix": "123", "grade": "fire", "title": "T", "summary": "S", "why": "W", "tags": ["a"], "url": "https://x.com"}]'
    recs = _parse_recommendations(raw)
    assert len(recs) == 1
    assert recs[0].grade == "fire"
    assert recs[0].title == "T"


def test_parse_recommendations_wrapped_object():
    raw = '{"items": [{"external_id_suffix": "456", "grade": "bolt", "title": "T2", "summary": "S2", "why": "W2", "tags": [], "url": "https://y.com"}]}'
    recs = _parse_recommendations(raw)
    assert len(recs) == 1


def test_parse_recommendations_skips_invalid():
    raw = '[{"external_id_suffix": "1", "grade": "fire", "title": "OK", "summary": "S", "why": "W", "tags": [], "url": "https://a.com"}, {"bad": true}]'
    recs = _parse_recommendations(raw)
    assert len(recs) == 1


def test_mock_recommendations():
    stories = [
        {"id": 100, "title": "Story A", "url": "https://a.com", "score": 50, "by": "u1", "time": 0},
        {"id": 101, "title": "Story B", "url": "https://b.com", "score": 30, "by": "u2", "time": 0},
        {"id": 102, "title": "Story C", "url": "https://c.com", "score": 10, "by": "u3", "time": 0},
        {"id": 103, "title": "Story D", "url": "https://d.com", "score": 5, "by": "u4", "time": 0},
    ]
    items = generate_recommendations(stories)
    assert len(items) == 3  # mock takes first 3
    assert items[0].agent_id == "radar"
    assert items[0].grade == "bolt"
    assert "hn-100-" in items[0].external_id


def test_empty_stories():
    items = generate_recommendations([])
    assert items == []
