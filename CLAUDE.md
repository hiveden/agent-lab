# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

agent-lab 是一个个人 AI Agent 平台（单用户多设备），当前聚焦 Radar Agent——从 Hacker News 等信息源发现高质量内容并推送给用户。核心理念是"认知镜像"：对比用户预设的注意力分配与实际消费行为。

## Architecture

**BFF + Agent Server 解耦，AG-UI Protocol 通信：**

- **BFF** (`apps/web`): Next.js 15 App Router，纯数据层——DB CRUD（Drizzle ORM）、Auth、SSE 透传、Cron 调度。**不做 LLM 推理。**
- **Agent Server** (`agents/`): Python FastAPI + LangGraph + LangChain，所有 Agent 逻辑——chat 对话、tool calling、evaluate 评判、ingest 采集。**无状态。**
- **通信协议**: AG-UI Protocol (SSE)，前端用 CopilotKit 消费，BFF 做 SSE passthrough
- **Data Storage**: Cloudflare D1 (SQLite)，通过 Drizzle ORM 访问
- **Shared Types** (`packages/types`): TypeScript 类型定义，Python 端通过 Pydantic 镜像

**Frontend:**
- **Agent Chat**: CopilotKit（AG-UI 前端客户端，Chat UI 组件）
- **State**: Zustand store — 5 slices (UI, Items, Pending, Sessions, Trace) + persist middleware
- **Data fetching**: SWR hooks (`use-items.ts`, `use-runs.ts`)
- **Components**: shadcn/ui — Button, Tabs, Command, Dialog, Badge, Sonner
- **Layout**: react-resizable-panels
- **Styling**: Tailwind utilities + CSS custom properties (design tokens)

### 数据流

```
Agent 对话:
  CopilotKit → BFF /api/agent/chat (SSE passthrough) → Python /agent/chat
    → LangGraph ReAct agent (LangChain LLM + tools) → AG-UI events → 前端渲染

采集 (Ingest):
  Cron/手动 → BFF /api/cron/radar/ingest → Python /ingest
    → Collectors 按 source_type 采集 → POST /api/raw-items/batch → D1

评判 (Evaluate):
  对话触发: 用户说"帮我评判" → LangGraph evaluate tool → 内部执行 pipeline → 结果回对话
  Cron 触发: BFF /api/cron/radar/evaluate → Python /evaluate → 独立 SSE pipeline
```

## Monorepo Structure

| Workspace | Runtime | Manager | Purpose |
|-----------|---------|---------|---------|
| `apps/web` | Node/Edge | pnpm | Next.js BFF + UI + Drizzle ORM |
| `packages/types` | Node | pnpm | 共享 TypeScript 类型 |
| `agents/shared` | Python 3.12 | uv | 配置、LLM 工厂、Pydantic schema、SSE 工具、PlatformClient |
| `agents/radar` | Python 3.12 | uv | Radar Agent（LangGraph agent + pipelines + collectors） |

## Common Commands

```bash
# 安装依赖
pnpm install          # Node 侧
uv sync               # Python 侧

# 开发（需要同时运行两个进程）
pnpm dev:web          # Next.js on :8788（含本地 D1）
cd agents/radar && uv run radar-serve   # FastAPI on :8001

# 手动触发（CLI 子命令）
cd agents/radar && uv run radar-push ingest     # 仅采集
cd agents/radar && uv run radar-push evaluate   # 仅评判
cd agents/radar && uv run radar-push push       # 采集+评判

# 构建与部署
pnpm build:web
pnpm deploy:web       # Cloudflare Pages

# 数据库
cd apps/web && pnpm db:init                    # 初始化本地 D1（含 seed）
cd apps/web && npx wrangler d1 execute agent-lab-dev --local --command "SQL"

# 测试
cd apps/web && pnpm test                                    # Vitest
uv run --package agent-lab-radar pytest agents/radar/tests/ -v  # pytest

# Python lint
uv tool run ruff check agents/
uv tool run ruff format agents/
```

## Key API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| **Agent Chat** | | |
| POST | `/api/agent/chat` | SSE 透传到 Python Agent (AG-UI) |
| **Sources** | | |
| GET/POST | `/api/sources` | Sources 列表 / 创建 |
| GET/PATCH/DELETE | `/api/sources/[id]` | Source 单条操作 |
| **Raw Items** | | |
| GET | `/api/raw-items` | 原始内容列表 |
| POST | `/api/raw-items/batch` | Agent 写入原始内容（Bearer auth） |
| PATCH | `/api/raw-items/batch-status` | Agent 标记评判结果 |
| **Items** | | |
| POST | `/api/items/batch` | Agent 推送评判后内容（幂等，Bearer auth） |
| GET | `/api/items` | 列表查询 |
| PATCH | `/api/items/:id/state` | 更新用户行为状态 |
| **Runs** | | |
| GET/POST | `/api/runs` | 执行记录列表 / 创建 |
| GET/PATCH | `/api/runs/[id]` | 执行记录详情 / 更新 |
| **Triggers** | | |
| POST | `/api/cron/radar/ingest` | 触发采集 |
| POST | `/api/cron/radar/evaluate` | 触发评判 |
| **Settings** | | |
| GET/PUT | `/api/settings` | LLM 配置 |
| POST | `/api/settings/test-connection` | LLM 连通性测试 |
| **Attention** | | |
| GET | `/api/attention/snapshot` | 注意力偏差快照 |

## Key Conventions

- **DB Schema**: `apps/web/src/lib/db/schema.ts` (Drizzle)，迁移文件在 `apps/web/migrations/`
- **DB 查询层**: `apps/web/src/lib/` 下 `items.ts`, `sources.ts`, `raw-items.ts`, `runs.ts`, `chat.ts`
- **API 验证**: `apps/web/src/lib/validations.ts` 使用 Zod schema
- **环境变量**: 通过 `apps/web/src/lib/env.ts` 的 `getEnv()` 获取 Cloudflare bindings
- **Python 配置**: `agents/shared` 使用 Pydantic Settings
- **Python Agent**: `agents/radar/src/radar/` — LangGraph agent + pipelines + collectors
- **Collector Protocol**: `agents/radar/src/radar/collectors/base.py`，4 种：hacker-news / http / rss / grok
- **LLM 多 Provider**: 所有 provider 走 `ChatOpenAI`（OpenAI-compatible），通过 `base_url` 切换
- **LLM Mock**: `LLM_MOCK=1` 启用 mock 模式（开发默认开启）
- **Agent 协议**: AG-UI Protocol，Python 端用 `ag-ui-protocol` + `ag-ui-langgraph`
- **前端 Chat**: CopilotKit 组件，消费 AG-UI SSE 事件
- **State**: Zustand store 管理 UI 状态，不在 RadarWorkspace 中添加 useState
- **Data fetching**: API 数据用 SWR hooks
- **UI Components**: shadcn/ui，从 `@/components/ui/` 导入
- **Styling**: Tailwind utilities + CSS variables + `cn()`

## Environment

需要 `.env` 文件（参考 `.env.example`）。关键变量：
- `LLM_MOCK` / `LLM_PROVIDER` / `GLM_API_KEY`: LLM 配置
- `GROK_API_KEY`: Grok API key（Twitter/X 采集用）
- `RADAR_WRITE_TOKEN`: Agent 写入认证 token
- `PLATFORM_API_BASE`: Python Agent 回调 Next.js 的地址（默认 `http://127.0.0.1:8788`）
- `SETTINGS_SECRET`: LLM Settings 加密密钥（64 字符 hex）
- `HTTPS_PROXY` / `HTTP_PROXY`: 代理配置

## Testing

```bash
pnpm test                                              # Vitest
uv run --package agent-lab-radar pytest agents/radar/tests/ -v  # pytest
bash scripts/run-e2e.sh                                # Playwright E2E
E2E_FILTER="Step 2b" bash scripts/run-e2e.sh           # 单个测试过滤
```

E2E 产出：`apps/web/e2e/test-results/` 下录屏 (.webm) + 截图 (.png) + trace (.zip)
