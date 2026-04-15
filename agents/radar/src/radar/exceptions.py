"""Radar Agent custom exception hierarchy."""

from agent_lab_shared.exceptions import (
    PlatformAPIError as SharedPlatformAPIError,
)


class RadarError(Exception):
    """Radar Agent 基础异常"""

    def __init__(self, message: str, *, context: dict | None = None):
        super().__init__(message)
        self.context = context or {}


class CollectorError(RadarError):
    """数据采集失败（网络超时、解析错误、API 限流）"""


class EvaluationError(RadarError):
    """LLM 评判失败（模型错误、响应解析失败）"""


class PlatformAPIError(SharedPlatformAPIError, RadarError):
    """BFF 平台 API 通信失败（同时是 SharedPlatformAPIError + RadarError 的子类）。"""

    def __init__(
        self,
        message: str,
        *,
        url: str | None = None,
        method: str | None = None,
        status_code: int | None = None,
        context: dict | None = None,
    ) -> None:
        SharedPlatformAPIError.__init__(
            self, message, url=url, method=method, status_code=status_code
        )
        # RadarError.__init__ 设置 self.context
        RadarError.__init__(self, message, context=context)


class ConfigurationError(RadarError):
    """配置缺失或无效"""
