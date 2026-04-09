# ROADMAP

## Phase 1 — MVP (Radar only)

**Goal**: 把 Radar 从 OpenClaw 迁出,在自建平台跑通推送流 + 对话流。

### 锁定决策

| 项 | 决策 |
|---|---|
| 仓库 | `agent-lab` monorepo,public |
| 前端 | Next.js + Cloudflare Pages + D1 |
| Agent | Python 3.12 + uv + LangChain,部署 Fly.io |
| LLM | GLM-4.6 (对话流) + GLM-4-Flash (推送流),封装 `get_llm(task_type)` |
| 用户 | 写死 `alex`,不做用户系统 |
| 域名 | `agents.<your-domain>`(待定) |

### 数据模型要点

`items` 表通用化,预留多 Agent:
- `agent_id` — 区分 radar / pulse / tts-quality
- `item_type` — recommendation / quality-issue / ...
- `payload` (JSON) — 通用扩展字段,不同 Agent 塞不同结构

### 实施顺序

- **Week 1** 平台空壳:monorepo 初始化 → Next.js → CF Pages 部署 → D1 schema → API `POST /items/batch` + `GET /items` → Radar 展示页(数据从 API fetch)
- **Week 2** Radar 推送流:`agents/radar` 初始化 → `shared/llm.py` → HN collector → recommend chain → Fly.io 部署 + cron
- **Week 3** Radar 对话流:chat chain + tools → FastAPI 端点 → Next.js 流式转发 → 对话 UI
- **Week 4** 收尾:历史 `push-history.md` 迁移 → 调试 → 文档

### 不做的(明确排除)

- 通用 Agent 框架(插件 / 配置中心 / 热插拔)
- 多通道(TG / 邮件)
- 多 Agent 编排
- 反馈闭环(learned-rules 回灌)
- 用户系统
- 记忆系统(用 LangChain 自带)

---

## Phase 2 — 多 Agent 扩展 + UI 升级

- **UI 重设计**(Phase 1 是最简可用版,Phase 2 重做):统一风格、视觉打磨、对话体验完善
- 加 Pulse Agent(复制 radar 改 prompt)
- 加 TTS Quality Agent(读 tts-agent-harness 的 chunks.json,给发音修复建议)
- LangChain → LangGraph 重写对话链
- 自建 CPA 反代服务,`get_llm()` 切 base_url

---

## Phase 3 — Public

- 反馈闭环
- 多用户 / 鉴权
- 订阅关键词
- RSS 输出
