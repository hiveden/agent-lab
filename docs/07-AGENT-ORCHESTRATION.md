# Agent 编排架构选型

> 调研时间：2026-04-13

## 当前状态

Radar agent 使用 Vercel AI SDK `streamText + tools + maxSteps` 做单 agent 编排：
- LLM 编排在 Next.js（Control Plane）
- Tool 执行在 Edge runtime（github_stats、web_search、search_items）
- Python 端负责采集/评判 pipeline（Ingest / Evaluate）
- 模型可切换（Ollama、GLM、Anthropic、Gemini）

## 三种编排模式

### 1. 图编排（Graph）
代表：**LangGraph**

节点 = agent/tool，边 = 条件路由。状态在图上流转，支持循环、分支、人工介入。

```
[入口] → [路由节点] → [搜索 agent] → [合并] → [输出]
                    ↘ [分析 agent] ↗
```

- 最灵活，适合复杂多步骤推理
- 内置 checkpoint（断点恢复、时间旅行）
- 学习曲线高

### 2. 角色协作（Role-based）
代表：**CrewAI**

定义角色（researcher、writer、critic），任务按顺序或并行分配。

```
Researcher → Writer → Critic → 最终输出
```

- DSL 简单，20 行代码起步
- 控制粒度粗，不适合需要精细状态管理的场景
- 无内置 checkpoint

### 3. Handoff 链（Handoff）
代表：**OpenAI Agents SDK / Anthropic Agent SDK**

Agent A 处理不了 → 显式转交给 Agent B，携带上下文。

```
通用 Agent → 判断需要专业知识 → handoff → 专家 Agent → 返回结果
```

- 线性清晰，像客服转接
- 适合明确分工场景
- OpenAI SDK 锁 vendor

## 主流框架对比

| 框架 | 编排模型 | 语言 | 模型锁定 | Stars | 生产案例 | 状态持久化 |
|---|---|---|---|---|---|---|
| **LangGraph** | 有向图 + 条件边 | Python | 无 | 25K | Uber, LinkedIn, JPMorgan | 内置 checkpoint + 时间旅行 |
| **CrewAI** | 角色 + 任务流 | Python | 无 | - | 中小项目为主 | 无内置 |
| **OpenAI Agents SDK** | Handoff | Python | OpenAI only | - | OpenAI 生态 | Context variables（临时） |
| **Google ADK** | 层级 agent 树 | Python | Gemini 为主 | - | Google Cloud 生态 | 依赖 Vertex AI |
| **Mastra** | Workflow + tools | TypeScript | 无 | - | 较新 | 内置 memory |
| **Vercel AI SDK** | streamText + tools | TypeScript | 无 | - | 广泛 | 无（自行实现） |
| **Anthropic Agent SDK** | Agent loop + tools | Python/TS | Claude 为主 | - | 最新发布 | 无内置 |

## 选型建议

### 学习价值排序

1. **LangGraph** — 图编排是最通用的抽象，理解它其他模式都能理解
2. **Vercel AI SDK** — 已在使用，单 agent + tool calling 的最简实现
3. **CrewAI** — 快速体验多 agent 协作，但理解深度有限

### 与 agent-lab 的适配

| 方案 | 适配度 | 原因 |
|---|---|---|
| **AI SDK 深化**（当前路径） | 高 | 已接入，单 agent 场景够用，TS 全栈 |
| **AI SDK + LangGraph** | 最佳 | AI SDK 管前端交互，LangGraph 管后端复杂编排，职责清晰 |
| **全切 LangGraph** | 中 | 需要重写前端交互层，收益不明确 |
| **CrewAI** | 低 | 黑盒太多，不适合学习底层原理 |

### 推荐路径

```
Phase 1（当前）：AI SDK 单 agent 做深
  → 更多 tool、更好的 prompt、多轮对话质量
  → 遇到单 agent 搞不定的场景再引入框架

Phase 2（需要多 agent 时）：引入 LangGraph
  → Python 端实现复杂编排（多步推理、agent 协作）
  → Next.js AI SDK 保持前端交互层
  → 通过 API 调用连接两层

Phase 3（成熟期）：自建编排
  → 基于实践经验抽象自己的编排层
  → 不依赖特定框架
```

## 触发 Phase 2 的信号

- 需要多个 agent 协作完成一个任务（如：搜索 agent + 分析 agent + 写作 agent）
- 需要复杂的条件分支（如：根据 item 类型路由到不同处理流程）
- 需要人工介入中间步骤（human-in-the-loop）
- 单 agent 的 `maxSteps` 不够用，推理链太长

## 参考资料

- [Best Multi-Agent Frameworks in 2026](https://gurusup.com/blog/best-multi-agent-frameworks-2026)
- [AI Agent Frameworks Compared: Which Ones Ship?](https://www.channel.tel/blog/ai-agent-frameworks-compared-2026-what-ships)
- [Comparing Open-Source AI Agent Frameworks - Langfuse](https://langfuse.com/blog/2025-03-19-ai-agent-comparison)
- [Top 11 AI Agent Frameworks (2026) - Lindy](https://www.lindy.ai/blog/best-ai-agent-frameworks)
