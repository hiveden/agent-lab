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
