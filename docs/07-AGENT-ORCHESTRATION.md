# Agent 编排架构选型

> 初次调研：2026-04-13
> 架构决策更新：2026-04-14

## 架构决策

**所有 Agent 逻辑统一到 Python，Next.js 纯 BFF，采用 AG-UI Protocol。**

### 决策过程

1. 最初方案：Vercel AI SDK `streamText + tools` 在 Next.js 做 Agent（Phase 1 快速验证）
2. 发现问题：evaluate 在 Python 用 LangChain，chat 在 Next.js 用 AI SDK，两套 LLM 串联
3. 考虑方案 A（全收 Next.js）：evaluate 搬到 AI SDK tool → 但 Agent 无法扩展，每加能力都要写 TS tool
4. 考虑方案 B（全收 Python）：Agent 统一到 Python → 便于扩展，后续可接 LangGraph
5. 确认方案 B，选择 AG-UI Protocol 替代 Vercel Data Stream Protocol

### 为什么不用 Vercel AI SDK Data Stream Protocol

| 维度 | Vercel Data Stream | AG-UI Protocol |
|------|-------------------|----------------|
| 设计目标 | Chat UI 流式渲染 | Agent 全生命周期 |
| 核心抽象 | message stream | thread / run / step |
| 状态同步 | 无（需 hack） | 一等公民 (JSON Patch) |
| Python SDK | 无官方，社区库不稳定 | 官方 `ag-ui-protocol`，Pydantic 类型安全 |
| LangGraph 集成 | 无 | 官方 `ag-ui-langgraph` |
| Human-in-the-loop | 无 | Interrupts 机制 |
| 学习价值 | Chat 流式渲染 | Agent 架构完整模型 |

**核心理由：学习优先。** AG-UI 的协议设计本身是一份 Agent 架构教材——thread/run 模型、step 生命周期、state sync、tool calling 流转。

---

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

| 框架 | 编排模型 | 语言 | 模型锁定 | 生产案例 | 状态持久化 |
|---|---|---|---|---|---|
| **LangGraph** | 有向图 + 条件边 | Python | 无 | Uber, LinkedIn, JPMorgan | 内置 checkpoint + 时间旅行 |
| **CrewAI** | 角色 + 任务流 | Python | 无 | 中小项目为主 | 无内置 |
| **OpenAI Agents SDK** | Handoff | Python | OpenAI only | OpenAI 生态 | Context variables（临时） |
| **Google ADK** | 层级 agent 树 | Python | Gemini 为主 | Google Cloud 生态 | 依赖 Vertex AI |
| **Vercel AI SDK** | streamText + tools | TypeScript | 无 | 广泛 | 无（自行实现） |
| **Anthropic Agent SDK** | Agent loop + tools | Python/TS | Claude 为主 | 最新发布 | 无内置 |

## 演进路径

```
Phase 1（当前）：Python 单 Agent + AG-UI Protocol
  → chat + tool calling + evaluate 全在 Python
  → AG-UI 事件流连接前后端
  → 学习：Agent loop、tool calling、state management、AG-UI 协议

Phase 2（多 Agent）：引入 LangGraph
  → AG-UI 有官方 LangGraph 适配器（ag-ui-langgraph）
  → 图编排实现 Agent 协作
  → 学习：graph state、checkpoint、conditional edges

Phase 3（成熟期）：自建编排
  → 基于实践经验抽象自己的编排层
  → 不依赖特定框架
```

## 触发 Phase 2 的信号

- 需要多个 agent 协作完成一个任务
- 需要复杂的条件分支
- 需要人工介入中间步骤（human-in-the-loop）
- 单 agent loop 的推理链太长

## 参考资料

- [AG-UI Protocol Documentation](https://docs.ag-ui.com/introduction)
- [AG-UI Architecture](https://docs.ag-ui.com/concepts/architecture)
- [py-ai-datastream](https://github.com/elementary-data/py-ai-datastream) — Vercel 协议 Python 实现（对比参考）
- [Vercel AI SDK Data Stream Protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol)
- [Best Multi-Agent Frameworks in 2026](https://gurusup.com/blog/best-multi-agent-frameworks-2026)
- [AI Agent Frameworks Compared](https://www.channel.tel/blog/ai-agent-frameworks-compared-2026-what-ships)
- [Comparing Open-Source AI Agent Frameworks - Langfuse](https://langfuse.com/blog/2025-03-19-ai-agent-comparison)
