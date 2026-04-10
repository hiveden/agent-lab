"""Radar FastAPI 服务:对话流 SSE 端点。"""

from __future__ import annotations

import json
import time
import uuid
from collections.abc import AsyncIterator
from typing import Any

from agent_lab_shared.config import settings
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .chains.chat import chat_stream
from .push import event_to_sse, run_push_stream

app = FastAPI(title="Radar Agent", version="0.0.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatCompletionRequest(BaseModel):
    model: str = "radar"
    messages: list[ChatMessage]
    stream: bool = False
    temperature: float | None = None


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


async def _openai_sse_iter(messages: list[dict[str, Any]]) -> AsyncIterator[bytes]:
    """SSE 输出, 完全对齐 OpenAI chat.completion.chunk 格式。"""
    chat_id = f"chatcmpl-{uuid.uuid4().hex}"
    created = int(time.time())
    
    # 提取 system_message 作为 item context (可选)
    system_msg = next((m["content"] for m in messages if m["role"] == "system"), None)
    item_ctx = {"summary": system_msg} if system_msg else None

    # 去掉 system message,因为 chain 里有自己的 template
    user_messages = [m for m in messages if m["role"] != "system"]

    try:
        async for chunk in chat_stream(user_messages, item_ctx):
            payload = {
                "id": chat_id,
                "object": "chat.completion.chunk",
                "created": created,
                "model": "radar",
                "choices": [{"index": 0, "delta": {"content": chunk}, "finish_reason": None}],
            }
            yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")
        
        # 结束标记
        payload = {
            "id": chat_id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": "radar",
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
        }
        yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")

    except Exception as e:  # noqa: BLE001
        err_payload = {
            "id": chat_id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": "radar",
            "choices": [{"index": 0, "delta": {"content": f"\n\n[Error: {e}]"}, "finish_reason": "stop"}],
        }
        yield f"data: {json.dumps(err_payload, ensure_ascii=False)}\n\n".encode("utf-8")
    
    yield b"data: [DONE]\n\n"


@app.post("/v1/chat/completions")
async def chat_completions(req: ChatCompletionRequest) -> StreamingResponse:
    messages = [m.model_dump() for m in req.messages]
    
    if not req.stream:
        raise HTTPException(status_code=400, detail="Only stream=True is supported")

    return StreamingResponse(
        _openai_sse_iter(messages),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


class PushRequest(BaseModel):
    limit: int = 30



async def _push_sse(limit: int) -> AsyncIterator[bytes]:
    """把 run_push_stream 的事件序列化成 SSE。"""
    try:
        async for ev in run_push_stream(limit=limit):
            yield event_to_sse(ev)
    except Exception as e:  # noqa: BLE001
        yield event_to_sse({"type": "error", "message": f"unhandled: {e}"})
    yield b"data: [DONE]\n\n"


@app.post("/cron/push")
async def cron_push(
    req: PushRequest,
    authorization: str | None = Header(default=None),
) -> StreamingResponse:
    """触发一次 Radar 推送流,SSE 流式输出进度事件。

    Bearer token 用 RADAR_WRITE_TOKEN (复用,避免再加一个 secret)。
    """
    expected = f"Bearer {settings.radar_write_token}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="unauthorized")
    return StreamingResponse(
        _push_sse(req.limit),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def serve() -> None:
    """uv run radar-serve 的入口。"""
    import uvicorn

    uvicorn.run(
        "radar.main:app",
        host="0.0.0.0",
        port=settings.radar_agent_port,
        reload=False,
    )
