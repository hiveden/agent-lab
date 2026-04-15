"""请求日志中间件 + 全局异常处理器。

RequestLoggingMiddleware 为每个 HTTP 请求：
1. 生成 request_id (uuid4) 并绑定到 structlog contextvars
2. 记录 method / path / status_code / duration_ms
3. 请求结束时清理 contextvars

全局异常处理器：
- RadarError 子类 → 对应 HTTP status + 结构化 JSON 错误体
- 未捕获 Exception → 500 + ERROR 日志 + traceback
"""

from __future__ import annotations

import time
import traceback
import uuid

import structlog
from agent_lab_shared.logging import get_logger
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

from .exceptions import (
    CollectorError,
    ConfigurationError,
    EvaluationError,
    PlatformAPIError,
    RadarError,
)

log = get_logger("radar.middleware")

# ── HTTP status 映射 ──

_STATUS_MAP: dict[type[RadarError], int] = {
    CollectorError: 502,
    PlatformAPIError: 502,
    EvaluationError: 500,
    ConfigurationError: 500,
}


def _status_for(err: RadarError) -> int:
    """根据异常类型返回对应的 HTTP status code。"""
    return _STATUS_MAP.get(type(err), 500)


# ── 请求日志中间件 ──


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """ASGI 中间件：request_id 绑定 + 请求/响应日志 + 异常兜底。

    注意：BaseHTTPMiddleware.call_next 会让异常穿透（re-raise），
    而 Starlette 的 ExceptionMiddleware（exception_handler 注册处）
    在内层，无法捕获中间件 dispatch 中 re-raise 的异常。
    因此在 dispatch 中同时做异常捕获，确保所有异常都能被转化为
    结构化 JSON 响应。exception_handler 仍注册作为不经过本中间件
    的请求的兜底。
    """

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        request_id = str(uuid.uuid4())
        structlog.contextvars.bind_contextvars(request_id=request_id)

        method = request.method
        path = request.url.path

        log.info("request_start", method=method, path=path)

        start = time.monotonic()
        response: Response | None = None
        try:
            response = await call_next(request)
        except RadarError as exc:
            response = _build_radar_error_response(exc)
        except Exception as exc:
            response = _build_generic_error_response(exc)
        finally:
            duration_ms = round((time.monotonic() - start) * 1000, 2)
            status_code = response.status_code if response is not None else 500
            log.info(
                "request_end",
                method=method,
                path=path,
                status_code=status_code,
                duration_ms=duration_ms,
            )
            structlog.contextvars.clear_contextvars()

        # 注入 request_id 到响应头
        response.headers["X-Request-ID"] = request_id
        return response


# ── 错误响应构建 ──


def _build_radar_error_response(exc: RadarError) -> JSONResponse:
    """RadarError → 对应 HTTP status + 结构化 JSON 错误体。"""
    status_code = _status_for(exc)
    error_type = type(exc).__name__

    log.warning(
        "radar_error",
        error_type=error_type,
        message=str(exc),
        context=exc.context,
        status_code=status_code,
    )

    return JSONResponse(
        status_code=status_code,
        content={
            "error": error_type,
            "message": str(exc),
            "context": exc.context,
        },
    )


def _build_generic_error_response(exc: Exception) -> JSONResponse:
    """未捕获 Exception → 500 + ERROR 日志 + traceback。"""
    log.error(
        "unhandled_exception",
        error_type=type(exc).__name__,
        message=str(exc),
        traceback=traceback.format_exc(),
    )

    return JSONResponse(
        status_code=500,
        content={
            "error": "InternalServerError",
            "message": "An unexpected error occurred.",
        },
    )


# ── 全局异常处理器（兜底：不经过中间件的请求） ──


async def radar_error_handler(request: Request, exc: RadarError) -> JSONResponse:
    """处理 RadarError 及其子类。"""
    return _build_radar_error_response(exc)


async def generic_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """处理未捕获的 Exception。"""
    return _build_generic_error_response(exc)
