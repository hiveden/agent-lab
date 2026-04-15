"""structlog 结构化日志基础设施测试。"""

from __future__ import annotations

import logging
from unittest.mock import patch

import structlog
from agent_lab_shared.logging import get_logger, setup_logging


class TestSetupLogging:
    """setup_logging() 初始化测试。"""

    def setup_method(self) -> None:
        """每个测试前重置 structlog 配置和 contextvars。"""
        structlog.reset_defaults()
        structlog.contextvars.clear_contextvars()
        # 清除 root logger handlers
        root = logging.getLogger()
        root.handlers.clear()

    def test_setup_logging_completes(self) -> None:
        """setup_logging() 调用不报错。"""
        setup_logging()

    def test_dev_uses_console_renderer(self) -> None:
        """dev 环境使用 ConsoleRenderer（在 ProcessorFormatter 中）。"""
        setup_logging(deploy_env="development")
        # renderer 在 ProcessorFormatter 中，检查 handler 的 formatter
        root = logging.getLogger()
        fmt = root.handlers[0].formatter
        assert isinstance(fmt, structlog.stdlib.ProcessorFormatter)
        # ProcessorFormatter.processors 最后一个是 renderer
        final = fmt.processors[-1]
        assert isinstance(final, structlog.dev.ConsoleRenderer)

    def test_prod_uses_json_renderer(self) -> None:
        """production 环境使用 JSONRenderer（在 ProcessorFormatter 中）。"""
        setup_logging(deploy_env="production")
        root = logging.getLogger()
        fmt = root.handlers[0].formatter
        assert isinstance(fmt, structlog.stdlib.ProcessorFormatter)
        final = fmt.processors[-1]
        assert isinstance(final, structlog.processors.JSONRenderer)

    def test_dev_log_level_is_debug(self) -> None:
        """dev 环境默认 DEBUG 级别。"""
        setup_logging(deploy_env="development")
        assert logging.getLogger().level == logging.DEBUG

    def test_prod_log_level_is_info(self) -> None:
        """prod 环境默认 INFO 级别。"""
        setup_logging(deploy_env="production")
        assert logging.getLogger().level == logging.INFO

    def test_explicit_log_level_overrides(self) -> None:
        """显式指定 log_level 覆盖默认值。"""
        setup_logging(deploy_env="development", log_level="WARNING")
        assert logging.getLogger().level == logging.WARNING

    def test_stdlib_handler_installed(self) -> None:
        """stdlib root logger 至少有一个 handler（structlog formatter）。"""
        setup_logging()
        root = logging.getLogger()
        assert len(root.handlers) >= 1
        handler = root.handlers[0]
        assert isinstance(handler.formatter, structlog.stdlib.ProcessorFormatter)


class TestContextVars:
    """contextvars 上下文绑定测试。"""

    def setup_method(self) -> None:
        structlog.reset_defaults()
        structlog.contextvars.clear_contextvars()
        logging.getLogger().handlers.clear()

    def test_global_context_bound(self) -> None:
        """setup_logging() 后 agent_id 和 deploy_env 在 contextvars 中。"""
        setup_logging(deploy_env="development", agent_id="radar")
        ctx = structlog.contextvars.get_contextvars()
        assert ctx["agent_id"] == "radar"
        assert ctx["deploy_env"] == "development"

    def test_request_context_bind_and_unbind(self) -> None:
        """请求级上下文可以 bind/unbind。"""
        setup_logging()
        structlog.contextvars.bind_contextvars(request_id="req-001", run_id="run-42")
        ctx = structlog.contextvars.get_contextvars()
        assert ctx["request_id"] == "req-001"
        assert ctx["run_id"] == "run-42"

        structlog.contextvars.unbind_contextvars("request_id", "run_id")
        ctx = structlog.contextvars.get_contextvars()
        assert "request_id" not in ctx
        assert "run_id" not in ctx

    def test_context_propagates_to_log_output(self, capsys) -> None:
        """绑定的上下文会出现在日志输出中。"""
        setup_logging(deploy_env="production", agent_id="test-agent")
        structlog.contextvars.bind_contextvars(request_id="req-xyz")

        log = get_logger("test")
        log.info("hello", key="value")

        captured = capsys.readouterr()
        # JSONRenderer 输出到 stderr
        output = captured.err
        assert "request_id" in output
        assert "req-xyz" in output
        assert "agent_id" in output
        assert "test-agent" in output

        structlog.contextvars.unbind_contextvars("request_id")


class TestGetLogger:
    """get_logger() 测试。"""

    def setup_method(self) -> None:
        structlog.reset_defaults()
        structlog.contextvars.clear_contextvars()
        logging.getLogger().handlers.clear()

    def test_returns_bound_logger(self) -> None:
        """get_logger() 返回 structlog BoundLogger。"""
        setup_logging()
        log = get_logger("radar.test")
        assert log is not None

    def test_logger_can_output(self, capsys) -> None:
        """logger 可以正常输出各级别日志。"""
        # 用 dev 模式（DEBUG）确保所有级别都输出
        setup_logging(deploy_env="development", log_level="DEBUG")
        log = get_logger("radar.test")

        log.info("test_info", count=1)
        log.warning("test_warn")
        log.error("test_error", detail="oops")
        log.debug("test_debug")

        output = capsys.readouterr().err
        assert "test_info" in output
        assert "test_warn" in output
        assert "test_error" in output
        assert "test_debug" in output

    def test_prod_filters_debug(self, capsys) -> None:
        """prod 模式下 DEBUG 日志被过滤（INFO 级别）。"""
        setup_logging(deploy_env="production")
        log = get_logger("radar.test")

        log.debug("should_not_appear")
        log.info("should_appear")

        output = capsys.readouterr().err
        assert "should_not_appear" not in output
        assert "should_appear" in output

    def test_logger_captures_exception(self, capsys) -> None:
        """logger.exception() 能捕获异常堆栈。"""
        setup_logging(deploy_env="production")
        log = get_logger("radar.test")

        try:
            raise ValueError("boom")
        except ValueError:
            log.exception("caught_error")

        output = capsys.readouterr().err
        assert "caught_error" in output
        assert "ValueError" in output
        assert "boom" in output
