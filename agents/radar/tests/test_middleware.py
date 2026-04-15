"""请求日志中间件 + 全局异常处理器 测试。"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from httpx import ASGITransport, AsyncClient

from radar.exceptions import (
    CollectorError,
    ConfigurationError,
    EvaluationError,
    PlatformAPIError,
    RadarError,
)
from radar.middleware import (
    RequestLoggingMiddleware,
    _status_for,
    generic_error_handler,
    radar_error_handler,
)


# ── Helper: 构建测试用 FastAPI app ──


def _create_test_app() -> FastAPI:
    """创建一个带中间件和异常处理器的最小 FastAPI app。"""
    app = FastAPI()
    app.add_middleware(RequestLoggingMiddleware)
    app.add_exception_handler(RadarError, radar_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, generic_error_handler)

    @app.get("/ok")
    async def ok():
        return {"status": "ok"}

    @app.get("/raise-collector")
    async def raise_collector():
        raise CollectorError("HN timeout", context={"source": "hacker-news"})

    @app.get("/raise-evaluation")
    async def raise_evaluation():
        raise EvaluationError("LLM parse failed")

    @app.get("/raise-platform")
    async def raise_platform():
        raise PlatformAPIError("502 from BFF")

    @app.get("/raise-config")
    async def raise_config():
        raise ConfigurationError("missing API key")

    @app.get("/raise-radar-base")
    async def raise_radar_base():
        raise RadarError("generic radar error")

    @app.get("/raise-generic")
    async def raise_generic():
        raise RuntimeError("unexpected boom")

    @app.get("/sse")
    async def sse_endpoint():
        async def generate():
            yield b"data: hello\n\n"
            yield b"data: world\n\n"

        return StreamingResponse(generate(), media_type="text/event-stream")

    return app


@pytest.fixture()
def test_app() -> FastAPI:
    return _create_test_app()


# ── status 映射测试 ──


class TestStatusMapping:
    def test_collector_error_maps_to_502(self):
        assert _status_for(CollectorError("x")) == 502

    def test_platform_api_error_maps_to_502(self):
        assert _status_for(PlatformAPIError("x")) == 502

    def test_evaluation_error_maps_to_500(self):
        assert _status_for(EvaluationError("x")) == 500

    def test_configuration_error_maps_to_500(self):
        assert _status_for(ConfigurationError("x")) == 500

    def test_base_radar_error_maps_to_500(self):
        assert _status_for(RadarError("x")) == 500


# ── 请求日志中间件测试 ──


class TestRequestLoggingMiddleware:
    async def test_normal_request_returns_200(self, test_app: FastAPI):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            resp = await client.get("/ok")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}

    async def test_request_id_in_response_header(self, test_app: FastAPI):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            resp = await client.get("/ok")
        request_id = resp.headers.get("x-request-id")
        assert request_id is not None
        # UUID4 格式：8-4-4-4-12
        parts = request_id.split("-")
        assert len(parts) == 5

    async def test_request_id_unique_per_request(self, test_app: FastAPI):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            r1 = await client.get("/ok")
            r2 = await client.get("/ok")
        assert r1.headers["x-request-id"] != r2.headers["x-request-id"]

    async def test_logs_request_start_and_end(self, test_app: FastAPI):
        """验证中间件产生 request_start 和 request_end 日志。"""
        with patch("radar.middleware.log") as mock_log:
            async with AsyncClient(
                transport=ASGITransport(app=test_app), base_url="http://test"
            ) as client:
                await client.get("/ok")

            # 检查 request_start
            start_calls = [
                c for c in mock_log.info.call_args_list if c.args[0] == "request_start"
            ]
            assert len(start_calls) == 1
            assert start_calls[0].kwargs["method"] == "GET"
            assert start_calls[0].kwargs["path"] == "/ok"

            # 检查 request_end
            end_calls = [
                c for c in mock_log.info.call_args_list if c.args[0] == "request_end"
            ]
            assert len(end_calls) == 1
            assert end_calls[0].kwargs["status_code"] == 200
            assert "duration_ms" in end_calls[0].kwargs

    async def test_duration_ms_is_non_negative(self, test_app: FastAPI):
        with patch("radar.middleware.log") as mock_log:
            async with AsyncClient(
                transport=ASGITransport(app=test_app), base_url="http://test"
            ) as client:
                await client.get("/ok")

            end_calls = [
                c for c in mock_log.info.call_args_list if c.args[0] == "request_end"
            ]
            assert end_calls[0].kwargs["duration_ms"] >= 0


# ── RadarError 异常处理器测试 ──


class TestRadarErrorHandler:
    async def test_collector_error_returns_502(self, test_app: FastAPI):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            resp = await client.get("/raise-collector")
        assert resp.status_code == 502
        body = resp.json()
        assert body["error"] == "CollectorError"
        assert body["message"] == "HN timeout"
        assert body["context"] == {"source": "hacker-news"}

    async def test_evaluation_error_returns_500(self, test_app: FastAPI):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            resp = await client.get("/raise-evaluation")
        assert resp.status_code == 500
        body = resp.json()
        assert body["error"] == "EvaluationError"

    async def test_platform_api_error_returns_502(self, test_app: FastAPI):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            resp = await client.get("/raise-platform")
        assert resp.status_code == 502
        body = resp.json()
        assert body["error"] == "PlatformAPIError"

    async def test_configuration_error_returns_500(self, test_app: FastAPI):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            resp = await client.get("/raise-config")
        assert resp.status_code == 500
        body = resp.json()
        assert body["error"] == "ConfigurationError"

    async def test_base_radar_error_returns_500(self, test_app: FastAPI):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            resp = await client.get("/raise-radar-base")
        assert resp.status_code == 500
        body = resp.json()
        assert body["error"] == "RadarError"
        assert body["message"] == "generic radar error"
        assert body["context"] == {}


# ── 通用异常处理器测试 ──


class TestGenericErrorHandler:
    async def test_generic_exception_returns_500(self, test_app: FastAPI):
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            resp = await client.get("/raise-generic")
        assert resp.status_code == 500
        body = resp.json()
        assert body["error"] == "InternalServerError"
        assert body["message"] == "An unexpected error occurred."

    async def test_generic_exception_logs_error(self, test_app: FastAPI):
        with patch("radar.middleware.log") as mock_log:
            async with AsyncClient(
                transport=ASGITransport(app=test_app), base_url="http://test"
            ) as client:
                await client.get("/raise-generic")

            error_calls = [
                c
                for c in mock_log.error.call_args_list
                if c.args[0] == "unhandled_exception"
            ]
            assert len(error_calls) == 1
            assert error_calls[0].kwargs["error_type"] == "RuntimeError"
            assert "unexpected boom" in error_calls[0].kwargs["message"]
            assert "traceback" in error_calls[0].kwargs


# ── SSE 端点不被干扰 ──


class TestSSEEndpoint:
    async def test_sse_streams_normally(self, test_app: FastAPI):
        """SSE 端点（media_type=text/event-stream）不被中间件阻断。"""
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            resp = await client.get("/sse")
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers["content-type"]
        body = resp.text
        assert "data: hello" in body
        assert "data: world" in body

    async def test_sse_has_request_id(self, test_app: FastAPI):
        """SSE 端点也应该有 request_id 头。"""
        async with AsyncClient(
            transport=ASGITransport(app=test_app), base_url="http://test"
        ) as client:
            resp = await client.get("/sse")
        assert resp.headers.get("x-request-id") is not None
