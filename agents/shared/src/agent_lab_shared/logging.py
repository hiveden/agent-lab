"""结构化日志基础设施 — structlog + stdlib logging 桥接。

调用一次 ``setup_logging()`` 即可完成全局配置。第三方库
（LangChain、uvicorn 等）通过 stdlib logging 发出的日志会被
structlog processors 统一格式化。

用法::

    from agent_lab_shared.logging import setup_logging, get_logger

    setup_logging()                       # app 启动时调用一次
    log = get_logger("radar.ingest")
    log.info("pipeline_start", source_count=3)

上下文绑定（请求级）::

    import structlog
    structlog.contextvars.bind_contextvars(request_id="abc-123", run_id="run-1")
    # 后续同一 contextvars 作用域内的日志自动携带 request_id, run_id
    structlog.contextvars.unbind_contextvars("request_id", "run_id")
"""

from __future__ import annotations

import logging
import sys

import structlog


def setup_logging(
    deploy_env: str = "development",
    agent_id: str = "radar",
    log_level: str | None = None,
) -> None:
    """一次性配置 structlog + stdlib logging。

    Parameters
    ----------
    deploy_env:
        ``"development"`` → 彩色 ConsoleRenderer；
        其它（``"production"`` 等）→ JSONRenderer。
    agent_id:
        全局绑定到每条日志的 agent 标识。
    log_level:
        显式指定日志级别（DEBUG / INFO / WARNING / ERROR）。
        如果为 ``None``，dev 默认 DEBUG，prod 默认 INFO。
    """

    is_dev = deploy_env == "development"

    # -- 决定日志级别 --
    if log_level is not None:
        level = getattr(logging, log_level.upper(), logging.INFO)
    else:
        level = logging.DEBUG if is_dev else logging.INFO

    # -- 共享 processors（structlog 和 stdlib 都走这条链） --
    shared_processors: list[structlog.types.Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.UnicodeDecoder(),
    ]

    if is_dev:
        renderer: structlog.types.Processor = structlog.dev.ConsoleRenderer()
    else:
        renderer = structlog.processors.JSONRenderer()

    # -- 配置 structlog --
    # 使用 stdlib LoggerFactory，让 structlog 日志也走 stdlib logging 输出。
    # 这样 structlog 自身 + 第三方库的日志统一由 ProcessorFormatter 格式化。
    structlog.configure(
        processors=[
            *shared_processors,
            # 格式化异常信息（放在 renderer 前）
            structlog.processors.format_exc_info,
            # 将 structlog 事件交给 stdlib logging 处理
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # -- 桥接 stdlib logging → structlog 格式化 --
    # ProcessorFormatter 负责最终渲染：structlog 事件和第三方 stdlib 日志
    # 都在这里统一输出格式。
    formatter = structlog.stdlib.ProcessorFormatter(
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            renderer,
        ],
        foreign_pre_chain=shared_processors,
    )

    root_logger = logging.getLogger()
    # 清除已有 handlers，避免重复输出
    root_logger.handlers.clear()

    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(formatter)
    root_logger.addHandler(handler)
    root_logger.setLevel(level)

    # 降低第三方库的噪音
    for noisy in ("httpcore", "httpx", "urllib3", "asyncio"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    # -- 全局上下文绑定 --
    structlog.contextvars.bind_contextvars(
        agent_id=agent_id,
        deploy_env=deploy_env,
    )


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    """获取一个带名称的 structlog logger。

    Parameters
    ----------
    name:
        logger 名称，通常是模块路径，如 ``"radar.pipelines.evaluate"``。
    """
    return structlog.get_logger(name)
