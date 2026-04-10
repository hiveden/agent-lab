# 本地开发指南

## 架构与技术栈约定 (生产级)

为了支撑长期迭代和未来的多 Agent 平台化扩展，本项目确立了以下生产级架构原则：

1. **核心解耦 (控制面 vs 数据面)**:
   - **Next.js (Control Plane)**: 掌握 D1 数据库、状态管理、调度发起、UI 渲染。
   - **Python Agent (Data Plane)**: 降级为无状态引擎，专注于信息采集、RAG 和 LLM 编排，通过 API 获取必要上下文，执行完毕即焚。
2. **强类型与工程化底座**:
   - 数据库抛弃手写裸 SQL，全面拥抱 **Drizzle ORM** (强类型 + Migration 管理)。
   - 对话流抛弃手搓 SSE 解析，全面拥抱 **Vercel AI SDK** (`ai` 包)，解决中文字符截断乱码、状态管理脆弱等问题。

---

## 一次性准备

```bash
# 工具
brew install pnpm uv

# 复制环境变量
cp .env.example .env.local                  # 前端用
cp .env.example agents/radar/.env           # Agent 用

# 安装依赖
pnpm install                                 # 装 apps/web + packages/types
uv sync                                      # 装 agents/shared + agents/radar
```

## 启动顺序 (三个进程)

```bash
# 终端 1 — Next.js + 本地 D1
pnpm dev:web
# 默认 http://127.0.0.1:8788

# 终端 2 — Radar Agent FastAPI 服务 (对话流)
cd agents/radar && uv run radar-serve
# 默认 http://127.0.0.1:8001

# 终端 3 — 手动触发推送流 (一次性)
cd agents/radar && uv run radar-push
```

## 端口约定

| 服务 | 端口 | 说明 |
|---|---|---|
| Next.js (wrangler dev) | 8788 | API + UI + D1 |
| Radar Agent (FastAPI) | 8001 | 对话流 SSE |

## 数据流

```
推送流: cron.py → collectors → recommend chain → POST /api/items/batch → D1
对话流: 前端 → Next.js POST /api/chat → Radar /chat (SSE) → LLM → 流回
```

## Mock vs Real LLM

- 默认 `LLM_MOCK=1`,走假响应,零依赖外部
- 接真 LLM:`LLM_MOCK=0` + `GLM_API_KEY=xxx`

## 常用调试

```bash
# 直接看 D1 数据
cd apps/web && npx wrangler d1 execute agent-lab-dev --local --command "SELECT * FROM items LIMIT 5"

# 手动 POST 测试 API
curl -X POST http://127.0.0.1:8788/api/items/batch \
  -H "Authorization: Bearer dev-radar-token-change-me" \
  -H "Content-Type: application/json" \
  -d @scripts/sample-batch.json
```
