"""Radar agent LangChain tools — registry.

Exports `get_all_tools()` which returns all available tools
for use with `create_react_agent`. No module-level instantiation.
"""

from __future__ import annotations

from langchain_core.tools import BaseTool


def get_all_tools() -> list[BaseTool]:
    """Return all registered tools for the Radar agent.

    Imports are deferred to call-time to avoid import side effects
    (e.g. PlatformClient creation, settings access at module load).
    """
    from .evaluate import evaluate
    from .github_stats import github_stats
    from .search_items import search_items
    from .web_search import web_search

    return [evaluate, web_search, github_stats, search_items]
