"""Tests for github_stats tool."""

import pytest
from radar.tools.github_stats import github_stats

SAMPLE_REPO_RESPONSE = {
    "full_name": "anthropics/claude-code",
    "description": "CLI for Claude",
    "stargazers_count": 25000,
    "forks_count": 1200,
    "open_issues_count": 150,
    "language": "TypeScript",
    "pushed_at": "2026-04-10T12:00:00Z",
    "created_at": "2025-01-15T00:00:00Z",
    "license": {"spdx_id": "MIT"},
    "archived": False,
}


@pytest.mark.asyncio
async def test_github_stats_success(httpx_mock):
    """正常路径：返回仓库统计信息。"""
    httpx_mock.add_response(
        url="https://api.github.com/repos/anthropics/claude-code",
        json=SAMPLE_REPO_RESPONSE,
    )

    result = await github_stats.ainvoke({"repo": "anthropics/claude-code"})

    assert result["name"] == "anthropics/claude-code"
    assert result["description"] == "CLI for Claude"
    assert result["stars"] == 25000
    assert result["forks"] == 1200
    assert result["open_issues"] == 150
    assert result["language"] == "TypeScript"
    assert result["last_push"] == "2026-04-10T12:00:00Z"
    assert result["created"] == "2025-01-15T00:00:00Z"
    assert result["license"] == "MIT"
    assert result["archived"] is False


@pytest.mark.asyncio
async def test_github_stats_not_found(httpx_mock):
    """仓库不存在：返回 error dict。"""
    httpx_mock.add_response(
        url="https://api.github.com/repos/nonexistent/repo",
        status_code=404,
        json={"message": "Not Found"},
    )

    result = await github_stats.ainvoke({"repo": "nonexistent/repo"})

    assert "error" in result
    assert "不存在" in result["error"]
    assert "nonexistent/repo" in result["error"]


@pytest.mark.asyncio
async def test_github_stats_rate_limit(httpx_mock):
    """Rate limit (403)：返回限流错误。"""
    httpx_mock.add_response(
        url="https://api.github.com/repos/popular/repo",
        status_code=403,
        json={"message": "API rate limit exceeded"},
    )

    result = await github_stats.ainvoke({"repo": "popular/repo"})

    assert "error" in result
    assert "限流" in result["error"]


@pytest.mark.asyncio
async def test_github_stats_no_license(httpx_mock):
    """仓库没有 license：license 字段返回 None。"""
    data = {**SAMPLE_REPO_RESPONSE, "license": None}
    httpx_mock.add_response(
        url="https://api.github.com/repos/owner/no-license-repo",
        json=data,
    )

    result = await github_stats.ainvoke({"repo": "owner/no-license-repo"})

    assert result["license"] is None
    assert result["name"] == "anthropics/claude-code"
