"""GitHub Stats tool — 获取 GitHub 仓库的统计信息。"""

from __future__ import annotations

from typing import Any

import httpx
from langchain_core.tools import tool

from radar.collectors.base import proxy_kwargs

GITHUB_API = "https://api.github.com/repos"


@tool
async def github_stats(repo: str) -> dict[str, Any]:
    """获取 GitHub 仓库的统计信息，包括 stars、forks、open issues、最近更新时间等。当用户问到某个开源项目的活跃度、可靠性时使用。

    Args:
        repo: GitHub 仓库，格式为 owner/repo，例如 anthropics/claude-code
    """
    client_kwargs: dict[str, Any] = {
        "timeout": 20.0,
        "trust_env": False,
        **proxy_kwargs(),
    }
    try:
        async with httpx.AsyncClient(**client_kwargs) as client:
            resp = await client.get(
                f"{GITHUB_API}/{repo}",
                headers={
                    "Accept": "application/vnd.github.v3+json",
                    "User-Agent": "agent-lab",
                },
            )
            if resp.status_code == 404:
                return {"error": f"仓库 {repo} 不存在"}
            if resp.status_code == 403:
                return {"error": "GitHub API 限流，请稍后再试"}
            if not resp.is_success:
                return {"error": f"GitHub API 返回 {resp.status_code}：找不到仓库 {repo}"}

            data = resp.json()
            license_info = data.get("license")
            return {
                "name": data.get("full_name"),
                "description": data.get("description"),
                "stars": data.get("stargazers_count"),
                "forks": data.get("forks_count"),
                "open_issues": data.get("open_issues_count"),
                "language": data.get("language"),
                "last_push": data.get("pushed_at"),
                "created": data.get("created_at"),
                "license": license_info.get("spdx_id") if license_info else None,
                "archived": data.get("archived"),
            }
    except httpx.TimeoutException:
        return {"error": "请求 GitHub API 超时"}
    except httpx.HTTPError as e:
        return {"error": f"请求 GitHub API 失败：{e}"}
