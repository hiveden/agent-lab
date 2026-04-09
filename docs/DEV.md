# 本地开发指南

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
