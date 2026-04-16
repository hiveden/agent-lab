# agent-lab

个人 AI Agent 平台（单用户多设备），当前聚焦 **Radar Agent** — 从 Hacker News 等信息源发现高质量内容并推送给用户。核心理念是"认知镜像"：对比用户预设的注意力分配与实际消费行为。

## Stack

| 层 | 技术 | 说明 |
|---|---|---|
| **Agent Runtime** | LangGraph `create_react_agent` | ReAct loop，Python 3.12 + uv |
| **LLM** | LangChain `ChatOpenAI` | 多 Provider（GLM / Grok / Ollama），统一 OpenAI-compatible 接口 |
| **Agent ↔ Frontend** | AG-UI Protocol (SSE) | `ag-ui-protocol` + `ag-ui-langgraph` 事件桥接 |
| **Frontend Chat** | CopilotKit | AG-UI 消费 + Chat UI 组件 |
| **BFF** | Next.js 15 App Router | SSE 透传、DB CRUD、Auth、Cron 调度，不做 LLM 推理 |
| **Database** | Cloudflare D1 (SQLite) | Drizzle ORM |
| **State** | Zustand (5 slices + persist) | UI / Items / Pending / Sessions / Trace |
| **Data Fetching** | SWR | `useItems`, `useRuns` |
| **UI Components** | shadcn/ui + Tailwind CSS | Button, Tabs, Command, Dialog, Badge, Sonner |
| **Deploy** | Cloudflare Pages (Web) | Agent Server 独立部署 |

## Structure

```
agent-lab/
├── apps/web/              Next.js BFF + UI (Drizzle ORM)
├── agents/
│   ├── shared/            配置、LLM 工厂、Pydantic schema、PlatformClient
│   └── radar/             Radar Agent (LangGraph + pipelines + collectors)
├── packages/types/        共享 TypeScript 类型
└── scripts/               工具脚本
```

## Dev

```bash
pnpm install && uv sync         # 安装依赖
pnpm dev:web                     # Next.js on :8788
cd agents/radar && uv run radar-serve  # Agent Server on :8001
```
