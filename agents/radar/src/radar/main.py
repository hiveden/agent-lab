"""Radar FastAPI 服务: ingest + evaluate + AG-UI chat 端点。"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from ag_ui_langgraph import add_langgraph_fastapi_endpoint
from agent_lab_shared.config import settings
from agent_lab_shared.logging import setup_logging

# ── 初始化结构化日志（在 import 阶段即完成，确保后续所有模块都能使用） ──
setup_logging(deploy_env=settings.deploy_env, agent_id="radar")
from agent_lab_shared.db import PlatformClient
from agent_lab_shared.schema import SourceConfig
from agent_lab_shared.sse import SSE_DONE, progress_sse
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from pydantic import BaseModel

from .agent import create_radar_agent
from .agui_tracing import TracingLangGraphAGUIAgent
from .exceptions import RadarError
from .middleware import RequestLoggingMiddleware, generic_error_handler, radar_error_handler
from .pipelines.evaluate import run_evaluate_stream
from .pipelines.ingest import run_ingest_stream

# ── Checkpoint DB path (persisted across process restarts) ──
# agents/radar/data/checkpoints.db
_CHECKPOINT_DB = Path(__file__).resolve().parent.parent.parent / "data" / "checkpoints.db"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Initialise AsyncSqliteSaver, build agent, register AG-UI endpoint.

    The checkpointer is the single source of truth for conversation history —
    LangGraph state is persisted to SQLite and survives process restarts.
    """
    _CHECKPOINT_DB.parent.mkdir(parents=True, exist_ok=True)
    async with AsyncSqliteSaver.from_conn_string(str(_CHECKPOINT_DB)) as saver:
        graph = create_radar_agent(checkpointer=saver)
        ag_ui_agent = TracingLangGraphAGUIAgent(
            name="radar",
            description="Radar Agent — intelligent content discovery assistant",
            graph=graph,
        )
        add_langgraph_fastapi_endpoint(app, ag_ui_agent, path="/agent/chat")
        yield


app = FastAPI(title="Radar Agent", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RequestLoggingMiddleware)

# ── 全局异常处理器 ──
app.add_exception_handler(RadarError, radar_error_handler)  # type: ignore[arg-type]
app.add_exception_handler(Exception, generic_error_handler)

_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def _check_auth(authorization: str | None) -> None:
    expected = f"Bearer {settings.radar_write_token}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="unauthorized")


# ── Health ──


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


# ── Source Types ──


@app.get("/source-types")
async def source_types() -> dict:
    from .collectors.base import get_source_types

    return {"source_types": get_source_types()}


# ── Test Collect ──


class TestCollectRequest(BaseModel):
    source_type: str
    config: dict[str, Any] = {}


@app.post("/test-collect")
async def test_collect(
    req: TestCollectRequest,
    authorization: str | None = Header(default=None),
) -> dict:
    _check_auth(authorization)
    from .collectors.base import get_collector

    try:
        collector = get_collector(req.source_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # 限制测试抓取数量
    test_config = {**req.config}
    test_config.setdefault("limit", 3)

    try:
        items = await collector.collect(test_config)
        return {"ok": True, "count": len(items), "items": items[:3]}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


# ── Ingest ──


class IngestRequest(BaseModel):
    sources: list[SourceConfig] | None = None  # 如果 None，从 platform API 读取


async def _ingest_sse(sources: list[SourceConfig]) -> AsyncIterator[bytes]:
    try:
        async for ev in run_ingest_stream(sources):
            yield progress_sse(ev)
    except Exception as e:
        yield progress_sse({"type": "error", "message": f"unhandled: {e}"})
    yield SSE_DONE


@app.post("/ingest")
async def ingest(
    req: IngestRequest,
    authorization: str | None = Header(default=None),
) -> StreamingResponse:
    _check_auth(authorization)

    sources = req.sources
    if not sources:
        # 从 Control Plane 拉取 sources 配置
        client = PlatformClient()
        resp = client.get_sources(agent_id="radar")
        sources = [
            SourceConfig(id=s["id"], source_type=s["source_type"], config=s.get("config", {}))
            for s in resp.get("sources", [])
            if s.get("enabled", True)
        ]

    if not sources:
        raise HTTPException(status_code=400, detail="no enabled sources found")

    return StreamingResponse(
        _ingest_sse(sources),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )


# ── Evaluate ──


class EvaluateRequest(BaseModel):
    agent_id: str = "radar"
    prompt: str | None = None


async def _evaluate_sse(agent_id: str, user_prompt: str | None = None) -> AsyncIterator[bytes]:
    try:
        async for ev in run_evaluate_stream(agent_id, user_prompt=user_prompt):
            yield progress_sse(ev)
    except Exception as e:
        yield progress_sse({"type": "error", "message": f"unhandled: {e}"})
    yield SSE_DONE


@app.post("/evaluate")
async def evaluate(
    req: EvaluateRequest,
    authorization: str | None = Header(default=None),
) -> StreamingResponse:
    _check_auth(authorization)
    return StreamingResponse(
        _evaluate_sse(req.agent_id, user_prompt=req.prompt),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
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
