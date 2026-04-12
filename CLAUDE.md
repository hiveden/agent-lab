# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

agent-lab 是一个个人 AI Agent 平台（单用户多设备），当前 MVP 阶段聚焦 Radar Agent——从 Hacker News 等信息源发现高质量内容并推送给用户。核心理念是"认知镜像"：对比用户预设的注意力分配与实际消费行为。

## Architecture

**Control Plane / Data Plane 分离 + Ingestion / Intelligence 两阶段：**

- **Control Plane** (`apps/web`): Next.js 15 App Router 作为 BFF，负责路由、鉴权、D1 数据库 CRUD（Drizzle ORM）、Vercel AI SDK 流式对话、Sources 配置管理、调度 Agent 执行
- **Data Plane** (`agents/`): Python FastAPI 无状态引擎，被动唤醒执行爬虫/LLM 推理，结果推回 Control Plane 落库
- **Data Storage**: Cloudflare D1 (SQLite)，通过 Drizzle ORM 访问
- **Shared Types** (`packages/types`): TypeScript 类型定义，Python 端通过 Pydantic 镜像

**Frontend Architecture (v2):**
- **State**: Zustand store (`apps/web/src/lib/stores/radar-store.ts`) — 5 slices (UI, Items, Pending, Sessions, Trace) + persist middleware
- **Data fetching**: SWR hooks (`apps/web/src/lib/hooks/use-items.ts`, `use-runs.ts`)
- **Components**: shadcn/ui (`apps/web/src/components/ui/`) — Button, Tabs, Command, Dialog, Badge, Sonner
- **Layout**: react-resizable-panels（inbox vertical split, trace horizontal split）
- **Styling**: Tailwind utilities + CSS custom properties (design tokens) in `globals.css`; `cn()` from `apps/web/src/lib/utils.ts` for conditional classes
- **Frontend deps**: zustand, swr, react-resizable-panels, shadcn/ui (clsx, tailwind-merge, class-variance-authority, lucide-react)

### 数据流（两阶段）

```
Sources 配置(D1) → Cron/手动 → CP 读 sources → POST Python /ingest
  → Python 按 source_type 分发 collector → POST /api/raw-items/batch → D1 raw_items

Cron/手动 → POST Python /evaluate
  → Python 读 pending raw_items → LLM 评分筛选 → POST /api/items/batch → D1 items
```

## Monorepo Structure

| Workspace | Runtime | Manager | Purpose |
|-----------|---------|---------|---------|
| `apps/web` | Node/Edge | pnpm | Next.js BFF + UI + Drizzle ORM |
| `packages/types` | Node | pnpm | 共享 TypeScript 类型 |
| `agents/shared` | Python 3.12 | uv | 配置、LLM 工厂、Pydantic schema、SSE 工具、PlatformClient |
| `agents/radar` | Python 3.12 | uv | Radar Agent（pipelines/ingest + evaluate, collectors, chains） |

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
| **Sources** | | |
| GET/POST | `/api/sources` | Sources 列表 / 创建 |
| GET/PATCH/DELETE | `/api/sources/[id]` | Source 单条操作 |
| **Raw Items** | | |
| GET | `/api/raw-items` | 原始内容列表（支持 status/source/run 过滤） |
| POST | `/api/raw-items/batch` | Agent 写入原始内容（Bearer auth） |
| PATCH | `/api/raw-items/batch-status` | Agent 标记评判结果 |
| **Items** | | |
| POST | `/api/items/batch` | Agent 推送评判后内容（幂等，Bearer auth） |
| GET | `/api/items` | 列表查询（支持 grade/status/agent 过滤） |
| PATCH | `/api/items/:id/state` | 更新用户行为状态 |
| **Runs** | | |
| GET/POST | `/api/runs` | 执行记录列表 / 创建 |
| GET/PATCH | `/api/runs/[id]` | 执行记录详情 / 更新 |
| **Triggers** | | |
| POST | `/api/cron/radar/ingest` | CP 触发采集（读 sources → 调 Python /ingest） |
| POST | `/api/cron/radar/evaluate` | CP 触发评判（调 Python /evaluate） |
| **Settings** | | |
| GET/PUT | `/api/settings` | LLM 配置（GET 脱敏，PUT 加密存储） |
| POST | `/api/settings/test-connection` | LLM 连通性测试 |
| **Sources Testing** | | |
| POST | `/api/sources/test` | 代理到 Python /test-collect，验证采集配置 |
| **Attention** | | |
| GET | `/api/attention/snapshot` | 注意力偏差快照（expected vs actual） |
| **Chat** | | |
| POST | `/api/chat` | SSE 流式对话 |
| GET | `/api/chat/sessions/:itemId` | 对话历史 |

## Key Conventions

- **DB Schema**: `apps/web/src/lib/db/schema.ts` (Drizzle)，迁移文件在 `apps/web/migrations/`
- **DB 查询层**: `apps/web/src/lib/` 下 `items.ts`, `sources.ts`, `raw-items.ts`, `runs.ts`, `chat.ts`
- **API 验证**: `apps/web/src/lib/validations.ts` 使用 Zod schema，所有 API 路由复用
- **环境变量**: 通过 `apps/web/src/lib/env.ts` 的 `getEnv()` 获取 Cloudflare bindings
- **Python 配置**: `agents/shared` 使用 Pydantic Settings 从环境变量加载
- **Python Pipeline**: `agents/radar/src/radar/pipelines/` 下 `ingest.py`（采集）和 `evaluate.py`（评判）
- **Collector Protocol**: `agents/radar/src/radar/collectors/base.py` 定义 `Collector` 协议，4 种已注册：hacker-news / http / rss / grok
- **LLM Settings**: `apps/web/src/lib/settings.ts` + `llm_settings` 表，API key 用 AES-GCM 加密，`SETTINGS_SECRET` env var
- **LLM 多 Provider**: 所有 provider 走 `ChatOpenAI`（OpenAI-compatible），通过 `base_url` 切换
- **LLM Mock**: `LLM_MOCK=1` 启用 mock 模式（开发默认开启）
- **注意力聚合**: `apps/web/src/lib/attention.ts`，信号权重独立可调（SIGNAL_WEIGHTS）
- **Type 同步**: 修改类型时需同步更新 `packages/types/src/index.ts` 和 `agents/shared/src/agent_lab_shared/schema.py`
- **SSE 工具**: `agents/shared/src/agent_lab_shared/sse.py` 提供 `progress_sse()` 和 `openai_sse_chunk()`
- **State**: 使用 `useRadarStore` 管理所有 UI 状态，不要在 RadarWorkspace 中添加 useState
- **Data fetching**: API 数据用 SWR hooks，SSE streaming 保持手动管理
- **UI Components**: 新 UI 组件使用 shadcn/ui，从 `@/components/ui/` 导入
- **Styling**: JSX 中用 Tailwind utilities，design tokens 用 CSS variables，条件类用 `cn()`

## Environment

需要 `.env` 文件（参考 `.env.example`）。关键变量：
- `LLM_MOCK` / `LLM_PROVIDER` / `GLM_API_KEY`: LLM 配置
- `GROK_API_KEY`: Grok API key（Twitter/X 采集用）
- `RADAR_WRITE_TOKEN`: Agent 写入认证 token
- `PLATFORM_API_BASE`: Python Agent 回调 Next.js 的地址（默认 `http://127.0.0.1:8788`）
- `SETTINGS_SECRET`: LLM Settings 加密密钥（64 字符 hex，`openssl rand -hex 32`）
- `HTTPS_PROXY` / `HTTP_PROXY`: 代理配置（外网请求需要）

## Testing

```bash
pnpm test                                              # Vitest (16 tests)
uv run --package agent-lab-radar pytest agents/radar/tests/ -v  # pytest (22 tests)
bash scripts/run-e2e.sh                                # Playwright E2E (17 tests, desktop + mobile)
E2E_FILTER="Step 2b" bash scripts/run-e2e.sh           # 单个测试过滤
```

E2E 产出：`apps/web/e2e/test-results/` 下录屏 (.webm) + 截图 (.png) + trace (.zip)
