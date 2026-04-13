"""Recommend chain: 从 HN stories 中挑选 3-5 条生成 ItemInput。

不使用 with_structured_output (Gemini via OpenAI 兼容层常返回带 markdown fence 的 bare array),
改用手动 prompt + JSON 剥壳解析,兼容所有 OpenAI 兼容 provider。
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Literal

from agent_lab_shared.config import settings
from agent_lab_shared.llm import get_llm
from agent_lab_shared.schema import ItemInput
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field, ValidationError


class _Recommendation(BaseModel):
    external_id_suffix: str = Field(description="HN story id")
    grade: Literal["fire", "bolt", "bulb"]
    title: str
    summary: str
    why: str
    tags: list[str] = Field(default_factory=list)
    url: str


_SYSTEM = """你是 Radar,一个科技资讯策展 Agent,目标用户是正在转型 AI Agent 工程师的全栈开发者。
你的任务:从给定的 Hacker News top stories 中,挑选 3-5 条最值得推荐给用户的条目。

输出必须是**严格合法的 JSON 数组** (不要 markdown 代码块,不要解释文字),数组每个元素符合:
{
  "external_id_suffix": "<HN story id,原样>",
  "grade": "fire | bolt | bulb",   // fire=必读 bolt=有价值 bulb=可选
  "title": "<简洁中文标题>",
  "summary": "<2-3 句话中文总结>",
  "why": "<为什么推给这位用户,结合 AI Agent 工程师身份>",
  "tags": ["<2-4 个标签>"],
  "url": "<story 原 url>"
}

挑选偏好:AI / agent / LLM infra / 开发者工具 / 独立开发者故事。
不要返回任何 JSON 之外的内容,不要用 markdown ```json 包裹。"""

_USER_PROMPT = """以下是 top stories:

{stories}

请挑选 3-5 条并按上述 JSON 数组格式输出。"""


def _strip_code_fence(s: str) -> str:
    """剥掉 ```json ... ``` 或 ``` ... ``` 包装。"""
    s = s.strip()
    # 匹配 ```json\n...\n``` 或 ```\n...\n```
    m = re.match(r"^```(?:json)?\s*\n?(.*?)\n?```\s*$", s, re.DOTALL)
    if m:
        return m.group(1).strip()
    return s


def _parse_recommendations(raw: str) -> list[_Recommendation]:
    """鲁棒解析 LLM 输出为 _Recommendation 列表。

    支持:
      - 裸 array: `[{...}, {...}]`
      - 包 object: `{"items": [...]}`
      - markdown fence 包裹的上述两种
    """
    s = _strip_code_fence(raw)
    try:
        data = json.loads(s)
    except json.JSONDecodeError as e:
        raise ValueError(f"LLM returned non-JSON: {e}\nraw: {raw[:200]}") from e

    # Normalize to list
    if isinstance(data, dict) and "items" in data:
        data = data["items"]
    if not isinstance(data, list):
        raise ValueError(f"Expected JSON array, got {type(data).__name__}")

    out: list[_Recommendation] = []
    for i, entry in enumerate(data):
        try:
            out.append(_Recommendation.model_validate(entry))
        except ValidationError as e:
            # 容错:跳过单条错误,不整批失败
            print(f"[recommend] skip item {i}: {e}")
            continue
    return out


def _mock_recommendations(stories: list[dict[str, Any]]) -> list[ItemInput]:
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    round_at = datetime.now(timezone.utc)
    picks = stories[:3]
    out: list[ItemInput] = []
    for s in picks:
        sid = s.get("id")
        out.append(
            ItemInput(
                external_id=f"hn-{sid}-{today}",
                agent_id="radar",
                item_type="recommendation",
                grade="bolt",
                title=s.get("title", "(untitled)"),
                summary=f"来自 HN,score={s.get('score', 0)},by {s.get('by', '?')}",
                why="[mock] mocked recommendation",
                url=s.get("url"),
                source="hacker-news",
                tags=["mock", "hn"],
                payload={"hn_id": sid, "score": s.get("score", 0)},
                round_at=round_at,
            )
        )
    return out


def generate_recommendations(
    stories: list[dict[str, Any]],
    user_prompt: str | None = None,
) -> list[ItemInput]:
    """从 stories 生成 ItemInput 列表。mock 模式直接取前 3 条。

    user_prompt: 用户自定义提示词，非空时覆盖默认 system prompt。
    """
    if not stories:
        return []

    if settings.llm_mock:
        return _mock_recommendations(stories)

    llm = get_llm("push")

    system = user_prompt if user_prompt else _SYSTEM

    story_text = "\n".join(
        f"- id={s['id']} score={s.get('score', 0)} title={s['title']} url={s['url']}"
        for s in stories
    )
    messages = [
        SystemMessage(content=system),
        HumanMessage(content=_USER_PROMPT.format(stories=story_text)),
    ]
    response = llm.invoke(messages)
    raw = response.content if isinstance(response.content, str) else str(response.content)

    recs = _parse_recommendations(raw)

    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    round_at = datetime.now(timezone.utc)
    out: list[ItemInput] = []
    for rec in recs:
        out.append(
            ItemInput(
                external_id=f"hn-{rec.external_id_suffix}-{today}",
                agent_id="radar",
                item_type="recommendation",
                grade=rec.grade,
                title=rec.title,
                summary=rec.summary,
                why=rec.why,
                url=rec.url,
                source="hacker-news",
                tags=rec.tags,
                payload={},
                round_at=round_at,
            )
        )
    return out
