"""Pydantic mirror of packages/types/src/index.ts. 改动两边同步。"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

Grade = Literal["fire", "bolt", "bulb"]
ItemStatus = Literal["unread", "watching", "discussed", "dismissed", "applied", "rejected"]
AgentId = Literal["radar", "pulse", "scout", "tts-quality"]
ItemType = Literal["recommendation", "quality-issue"]
ChatRole = Literal["user", "assistant", "tool", "system"]
SourceType = Literal["hacker-news", "http", "rss", "grok"]
RawItemStatus = Literal["pending", "evaluated", "promoted", "rejected"]
RunPhase = Literal["ingest", "evaluate"]
RunStatus = Literal["running", "done", "failed"]


class ItemInput(BaseModel):
    """Agent → API 写入时的 item 形态(无 id/created_at)。"""

    external_id: str
    agent_id: AgentId
    item_type: ItemType
    grade: Grade
    title: str
    summary: str
    why: str | None = None
    url: str | None = None
    source: str | None = None
    tags: list[str] = Field(default_factory=list)
    payload: dict[str, Any] = Field(default_factory=dict)
    round_at: datetime


class ItemBatchInput(BaseModel):
    round_at: datetime
    items: list[ItemInput]


class Item(ItemInput):
    id: str
    created_at: datetime


class UserState(BaseModel):
    item_id: str
    user_id: str
    status: ItemStatus
    updated_at: datetime


class ChatMessage(BaseModel):
    id: str
    session_id: str
    role: ChatRole
    content: str
    tool_calls: list[Any] | None = None
    created_at: datetime


class ChatSession(BaseModel):
    id: str
    item_id: str | None = None
    agent_id: AgentId
    created_at: datetime


# ── Sources ──


class Source(BaseModel):
    id: str
    agent_id: AgentId
    source_type: SourceType
    name: str
    config: dict[str, Any] = Field(default_factory=dict)
    attention_weight: float = 0.0
    enabled: bool = True
    created_at: datetime
    updated_at: datetime


class SourceConfig(BaseModel):
    """Ingest pipeline 接收的 source 配置（轻量子集）。"""

    id: str
    source_type: SourceType
    config: dict[str, Any] = Field(default_factory=dict)


# ── Raw Items ──


class RawItemInput(BaseModel):
    """Collector → API 写入时的 raw item 形态。"""

    source_id: str
    agent_id: AgentId
    external_id: str
    title: str
    url: str | None = None
    raw_payload: dict[str, Any] = Field(default_factory=dict)


class RawItem(RawItemInput):
    id: str
    status: RawItemStatus = "pending"
    run_id: str | None = None
    fetched_at: datetime


# ── Runs ──


class Run(BaseModel):
    id: str
    agent_id: AgentId
    phase: RunPhase
    status: RunStatus = "running"
    source_ids: list[str] = Field(default_factory=list)
    stats: dict[str, Any] = Field(default_factory=dict)
    trace: list[Any] = Field(default_factory=list)
    error: str | None = None
    started_at: datetime
    finished_at: datetime | None = None
