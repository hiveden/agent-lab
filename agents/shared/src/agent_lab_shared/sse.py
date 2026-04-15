"""SSE 序列化工具函数。"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any


def progress_sse(event: dict[str, Any]) -> bytes:
    """把一个 progress event 序列化成一条 SSE data line。"""
    event.setdefault("ts", datetime.now(UTC).isoformat())
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n".encode()


def openai_sse_chunk(
    chat_id: str,
    created: int,
    model: str,
    content: str | None = None,
    finish_reason: str | None = None,
) -> bytes:
    """序列化一条 OpenAI chat.completion.chunk SSE line。"""
    delta: dict[str, str] = {}
    if content is not None:
        delta["content"] = content
    payload = {
        "id": chat_id,
        "object": "chat.completion.chunk",
        "created": created,
        "model": model,
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}],
    }
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode()


SSE_DONE = b"data: [DONE]\n\n"
