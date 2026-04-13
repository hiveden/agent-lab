"""Collector 协议、注册表、源类型元数据。"""

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


def _registry() -> dict[str, type[Collector]]:
    """延迟导入，避免循环依赖。"""
    from .grok_collector import GrokCollector
    from .hn import HNCollector
    from .http_collector import HttpCollector
    from .rss_collector import RssCollector

    return {
        "hacker-news": HNCollector,
        "http": HttpCollector,
        "rss": RssCollector,
        "grok": GrokCollector,
    }


def get_collector(source_type: str) -> Collector:
    """按 source_type 返回对应 collector 实例。"""
    registry = _registry()
    cls = registry.get(source_type)
    if cls is None:
        raise ValueError(f"Unknown source_type: {source_type}")
    return cls()


SOURCE_TYPE_META: dict[str, dict[str, Any]] = {
    "hacker-news": {
        "label": "Hacker News",
        "description": "HN Top Stories via Firebase API",
        "config_hint": {"limit": 30},
    },
    "http": {
        "label": "HTTP API (通用)",
        "description": "任意返回 JSON 的 REST API，配置 URL + 字段映射",
        "config_hint": {
            "url": "https://api.example.com/data",
            "method": "GET",
            "items_path": "data",
            "mapping": {
                "external_id": "id",
                "title": "title",
                "url": "url",
            },
        },
    },
    "rss": {
        "label": "RSS / Atom",
        "description": "RSS 或 Atom feed",
        "config_hint": {"feed_url": "https://example.com/feed", "limit": 20},
    },
    "grok": {
        "label": "Grok (Twitter/X)",
        "description": "通过 Grok API x_search 采集推文，需要 GROK_API_KEY",
        "config_hint": {
            "accounts": ["karpathy", "swyx"],
            "batch_size": 10,
            "api_url": "https://api.apiyi.com/v1/responses",
            "model": "grok-4-fast-non-reasoning",
        },
    },
}


def get_source_types() -> dict[str, dict[str, Any]]:
    """返回所有已注册的 source type 元数据。"""
    return SOURCE_TYPE_META


def proxy_kwargs() -> dict[str, Any]:
    """返回 httpx.AsyncClient 可直接解包的代理参数。从 Settings 读取，本地走代理，生产为空。"""
    from agent_lab_shared.config import settings

    proxy = settings.https_proxy or settings.http_proxy
    if proxy and proxy.startswith("http"):
        return {"proxy": proxy}
    return {}
