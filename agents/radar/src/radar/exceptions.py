"""Radar Agent custom exception hierarchy."""


class RadarError(Exception):
    """Radar Agent 基础异常"""

    def __init__(self, message: str, *, context: dict | None = None):
        super().__init__(message)
        self.context = context or {}


class CollectorError(RadarError):
    """数据采集失败（网络超时、解析错误、API 限流）"""


class EvaluationError(RadarError):
    """LLM 评判失败（模型错误、响应解析失败）"""


class PlatformAPIError(RadarError):
    """BFF 平台 API 通信失败"""


class ConfigurationError(RadarError):
    """配置缺失或无效"""
