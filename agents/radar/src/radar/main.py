"""Radar FastAPI 服务:对话流 SSE 端点。"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

from agent_lab_shared.config import settings
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .chains.chat import chat_stream
from .push import event_to_sse, run_push_stream

app = FastAPI(title="Radar Agent", version="0.0.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    """对齐 apps/web 的 /api/chat 转发契约。

    - session_id / item_id 由 Web 侧持久化和传递,Radar 内部不使用
    - message 是用户最新一轮的消息(单轮);多轮历史在 Phase 2 由 Web 加载后传入
    - item 可选,如果带上则注入到 system prompt 提供条目上下文
    """

    session_id: str | None = None
    item_id: str | None = None
    message: str
    item: dict[str, Any] | None = None
    history: list[dict[str, Any]] | None = None


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


async def _sse_iter(
    messages: list[dict[str, Any]], item: dict[str, Any] | None
) -> AsyncIterator[bytes]:
    """SSE 输出,chunk 格式与 apps/web 解析器对齐:{"type":"delta","content":"..."}"""
    try:
        async for chunk in chat_stream(messages, item):
            payload = json.dumps(
                {"type": "delta", "content": chunk}, ensure_ascii=False
            )
            yield f"data: {payload}\n\n".encode("utf-8")
    except Exception as e:  # noqa: BLE001
        err = json.dumps(
            {"type": "error", "error": str(e)}, ensure_ascii=False
        )
        yield f"data: {err}\n\n".encode("utf-8")
    yield b"data: [DONE]\n\n"


@app.post("/chat")
async def chat(req: ChatRequest) -> StreamingResponse:
    # 拼装 messages: history (可选) + 当前 user message
    messages: list[dict[str, Any]] = list(req.history or [])
    messages.append({"role": "user", "content": req.message})
    return StreamingResponse(
        _sse_iter(messages, req.item),
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
