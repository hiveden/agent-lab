# 本地开发指南

## 架构约定

1. **BFF 与 Agent 解耦**:
   - **Next.js (BFF)**: DB CRUD、Auth、SSE 透传、Cron 调度。不做 LLM 推理。
   - **Python Agent**: LangGraph agent loop、tool calling、采集 pipeline。无状态。
2. **通信协议**: AG-UI Protocol (SSE)，CopilotKit 前端渲染。
3. **数据归属**: 所有持久化状态在 BFF 的 D1 数据库，Agent Server 无状态。

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

## 启动顺序 (两个进程)

```bash
# 终端 1 — Next.js BFF + 本地 D1
pnpm dev:web
# http://127.0.0.1:8788

# 终端 2 — Radar Agent (FastAPI + LangGraph)
cd agents/radar && uv run radar-serve
# http://127.0.0.1:8001
```

## 端口约定

| 服务 | 端口 | 说明 |
|---|---|---|
| Next.js (wrangler dev) | 8788 | BFF + UI + D1 |
| Radar Agent (FastAPI) | 8001 | Agent chat (AG-UI SSE) + 采集 pipeline |

## 数据流

```
Agent 对话: CopilotKit → BFF /api/agent/chat → Python /agent/chat (AG-UI SSE) → LangGraph → LLM
采集流:     BFF /api/cron/radar/ingest → Python /ingest → Collectors → POST /api/raw-items/batch → D1
评判流:     用户对话触发 → LangGraph evaluate tool → 读 raw_items → LLM 评判 → 写 items → D1
           或 BFF /api/cron/radar/evaluate → Python /evaluate → 独立 SSE pipeline
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
