"""Recommend chain: 对 HN stories **每一条**做分类 (promoted 或 rejected + reason).

改造背景 (#2.8): 原 prompt 只让 LLM 返 3-5 条 promoted, 未入选的"为什么不选"
LLM 从未给出, 过滤模块无法可观测 prompt 对 rejected 的影响. 改成让 LLM 对
每条 story 都分类并给理由, 前端能分两区展示 promoted + rejected + why/reason.

不使用 with_structured_output (Gemini via OpenAI 兼容层常返回带 markdown fence),
改用手动 prompt + JSON 剥壳解析, 兼容所有 OpenAI 兼容 provider.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from typing import Any, Literal

from agent_lab_shared.llm import get_llm
from agent_lab_shared.schema import ItemInput
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field, ValidationError

from ..exceptions import EvaluationError


class _Recommendation(BaseModel):
    external_id_suffix: str = Field(description="HN story id")
    grade: Literal["fire", "bolt", "bulb"]
    title: str
    summary: str
    why: str
    tags: list[str] = Field(default_factory=list)
    url: str


class _RejectedItem(BaseModel):
    """未入选条目 + LLM 给的不推理由."""

    external_id_suffix: str = Field(description="HN story id")
    reason: str = Field(description="为什么不推荐, 一句话")


class _EvaluationResult(BaseModel):
    """LLM 对一批 stories 的完整分类结果."""

    promoted: list[_Recommendation] = Field(default_factory=list)
    rejected: list[_RejectedItem] = Field(default_factory=list)


_SYSTEM = """你是 Radar, 一个科技资讯策展 Agent, 目标用户是正在转型 AI Agent 工程师的全栈开发者。
你的任务: 对给定的 Hacker News top stories 中**每一条**做分类。

输出必须是**严格合法的 JSON object** (不要 markdown 代码块, 不要解释文字):
{
  "promoted": [
    {
      "external_id_suffix": "<HN story id, 原样>",
      "grade": "fire | bolt | bulb",   // fire=必读 bolt=有价值 bulb=可选
      "title": "<简洁中文标题>",
      "summary": "<2-3 句话中文总结>",
      "why": "<为什么推给这位用户, 结合 AI Agent 工程师身份>",
      "tags": ["<2-4 个标签>"],
      "url": "<story 原 url>"
    }
  ],
  "rejected": [
    {
      "external_id_suffix": "<HN story id, 原样>",
      "reason": "<一句话, 为什么不推>"
    }
  ]
}

规则:
- promoted 保留 3-5 条; 其他所有输入 stories **必须**进 rejected
- promoted + rejected 数量之和 = 输入 stories 总数 (不能漏)
- 每条 rejected 必须给一句话 reason, 不允许空
- 挑选偏好: AI / agent / LLM infra / 开发者工具 / 独立开发者故事

不要返回任何 JSON 之外的内容, 不要用 markdown ```json 包裹。"""

_USER_PROMPT = """以下是 top stories (共 {count} 条):

{stories}

请对每一条做分类 (promoted 或 rejected + reason), 按上述 JSON 格式输出。"""


def _strip_code_fence(s: str) -> str:
    """剥掉 ```json ... ``` 或 ``` ... ``` 包装."""
    s = s.strip()
    m = re.match(r"^```(?:json)?\s*\n?(.*?)\n?```\s*$", s, re.DOTALL)
    if m:
        return m.group(1).strip()
    return s


def _parse_evaluation(raw: str) -> _EvaluationResult:
    """鲁棒解析 LLM 输出为 _EvaluationResult.

    支持:
      - {"promoted": [...], "rejected": [...]} (期望格式)
      - 历史回退: 裸 array → 全当 promoted (兼容旧 prompt)
      - markdown fence 包裹
    """
    s = _strip_code_fence(raw)
    try:
        data = json.loads(s)
    except json.JSONDecodeError as e:
        raise EvaluationError(
            f"LLM returned non-JSON: {e}",
            context={"raw_preview": raw[:200]},
        ) from e

    # 新格式: object with promoted + rejected
    if isinstance(data, dict) and ("promoted" in data or "rejected" in data):
        try:
            return _EvaluationResult.model_validate(data)
        except ValidationError:
            # 对单条宽容: 逐条 validate, 坏的跳过
            promoted: list[_Recommendation] = []
            for entry in data.get("promoted") or []:
                try:
                    promoted.append(_Recommendation.model_validate(entry))
                except ValidationError as e:
                    print(f"[recommend] skip promoted: {e}")
            rejected: list[_RejectedItem] = []
            for entry in data.get("rejected") or []:
                try:
                    rejected.append(_RejectedItem.model_validate(entry))
                except ValidationError as e:
                    print(f"[recommend] skip rejected: {e}")
            return _EvaluationResult(promoted=promoted, rejected=rejected)

    # 兼容旧格式: 裸 array 全当 promoted (rejected 就空着, 前端会看到数量不一致但至少不崩)
    if isinstance(data, dict) and "items" in data:
        data = data["items"]
    if isinstance(data, list):
        promoted = []
        for i, entry in enumerate(data):
            try:
                promoted.append(_Recommendation.model_validate(entry))
            except ValidationError as e:
                print(f"[recommend] skip item {i}: {e}")
        return _EvaluationResult(promoted=promoted, rejected=[])

    raise EvaluationError(
        f"Expected JSON object with promoted/rejected, got {type(data).__name__}",
        context={"raw_preview": raw[:200]},
    )


def generate_recommendations(
    stories: list[dict[str, Any]],
    user_prompt: str | None = None,
) -> tuple[list[ItemInput], list[dict[str, str]]]:
    """对 stories 做 LLM 分类, 返回 (promoted ItemInputs, rejected [{external_id_suffix, reason}]).

    Args:
        stories: raw items 列表 (已转为 stories 格式)
        user_prompt: 可选, 覆盖默认 _SYSTEM prompt

    Returns:
        (items, rejected_list):
          - items: 可直接写入 items 表的 ItemInput 列表
          - rejected_list: [{"external_id_suffix": "...", "reason": "..."}, ...]
            供 evaluate pipeline/tool 构造 preview + 让前端展示
    """
    if not stories:
        return [], []

    llm = get_llm("push")

    system = user_prompt if user_prompt else _SYSTEM

    story_text = "\n".join(
        f"- id={s['id']} score={s.get('score', 0)} title={s['title']} url={s['url']}"
        for s in stories
    )
    messages = [
        SystemMessage(content=system),
        HumanMessage(content=_USER_PROMPT.format(count=len(stories), stories=story_text)),
    ]
    try:
        response = llm.invoke(messages)
    except Exception as e:
        raise EvaluationError(
            f"LLM invocation failed: {e}",
            context={"model": getattr(llm, "model_name", "unknown")},
        ) from e
    raw = response.content if isinstance(response.content, str) else str(response.content)

    result = _parse_evaluation(raw)

    today = datetime.now(UTC).strftime("%Y%m%d")
    round_at = datetime.now(UTC)
    items: list[ItemInput] = []
    for rec in result.promoted:
        items.append(
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

    rejected_list = [
        {"external_id_suffix": r.external_id_suffix, "reason": r.reason}
        for r in result.rejected
    ]

    return items, rejected_list
