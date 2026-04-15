"""Shared exception hierarchy for agent-lab Python agents."""

from __future__ import annotations


class PlatformAPIError(Exception):
    """Platform API 通信失败（Agent → Next.js BFF）。

    Attributes:
        url: 请求 URL
        method: HTTP method (GET / POST / PATCH …)
        status_code: HTTP 响应状态码（网络错误时为 None）
    """

    def __init__(
        self,
        message: str,
        *,
        url: str | None = None,
        method: str | None = None,
        status_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.url = url
        self.method = method
        self.status_code = status_code
