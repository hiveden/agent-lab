"""Collector 协议与注册表。"""

from __future__ import annotations

from typing import Any, Protocol, TypedDict


class RawCollectorItem(TypedDict):
    """Collector 产出的标准格式，直接对应 raw_items 表字段。"""

    external_id: str
    title: str
    url: str | None
    raw_payload: dict[str, Any]


class Collector(Protocol):
    """所有 collector 必须实现此接口。"""

    async def collect(self, config: dict[str, Any]) -> list[RawCollectorItem]: ...


def get_collector(source_type: str) -> Collector:
    """按 source_type 返回对应 collector 实例。"""
    from .hn import HNCollector

    registry: dict[str, type[Collector]] = {
        "hacker-news": HNCollector,
    }
    cls = registry.get(source_type)
    if cls is None:
        raise ValueError(f"Unknown source_type: {source_type}")
    return cls()
