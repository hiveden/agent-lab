# ARCHITECTURE: Radar 系统架构

> **定位**: 单用户多设备、重度数据追踪的 Agent 系统。
> **原则**: BFF 与 Agent 严格解耦；不造轮子，用成熟框架。
> **学习导向**: 架构决策优先学习价值，不以上线速度为目标。

---

## 一、技术选型

### Frontend

| 框架 | 用途 | 文档 |
|------|------|------|
| **Next.js 15** | App Router, BFF 层, SSR/Edge Runtime | https://nextjs.org/docs |
| **CopilotKit** | Agent Chat UI 组件, AG-UI 前端客户端 | https://docs.copilotkit.ai |
| **Zustand** | 客户端状态管理 (UI state, 乐观更新) | https://zustand.docs.pmnd.rs |
| **SWR** | 数据请求缓存 (items, runs 列表) | https://swr.vercel.app |
| **shadcn/ui** | UI 组件库 (Button, Tabs, Dialog, Badge) | https://ui.shadcn.com |
| **react-resizable-panels** | 可拖拽分栏布局 | https://github.com/bvaughn/react-resizable-panels |
| **Tailwind CSS** | 原子化样式 + CSS 变量 design tokens | https://tailwindcss.com/docs |

### Agent 运行时

| 框架 | 用途 | 文档 |
|------|------|------|
| **LangChain** | LLM 抽象层, 多 provider 兼容 (OpenAI-compatible) | https://python.langchain.com/docs |
| **LangGraph** | Agent loop (ReAct), tool calling 循环, 状态图 | https://langchain-ai.github.io/langgraph |
| **FastAPI** | Agent HTTP 服务, SSE streaming | https://fastapi.tiangolo.com |

### Agent 协议

| 框架 | 用途 | 文档 |
|------|------|------|
| **AG-UI Protocol** | Agent ↔ 前端的标准事件协议 (SSE) | https://docs.ag-ui.com |
| **ag-ui-protocol** | AG-UI Python SDK, Pydantic 事件模型 + EventEncoder | https://pypi.org/project/ag-ui-protocol |
| **ag-ui-langgraph** | LangGraph → AG-UI 事件桥接层 | https://pypi.org/project/ag-ui-langgraph |

### 数据层

| 框架 | 用途 | 文档 |
|------|------|------|
| **Cloudflare D1** | SQLite 数据库 (items, sources, runs, chat) | https://developers.cloudflare.com/d1 |
| **Drizzle ORM** | TypeScript ORM, schema 定义 + 迁移 | https://orm.drizzle.team/docs/overview |

### 基础设施

| 框架 | 用途 | 文档 |
|------|------|------|
| **Cloudflare Pages** | Next.js 部署 + Edge Runtime | https://developers.cloudflare.com/pages |
| **pnpm** | Node 包管理 (workspace monorepo) | https://pnpm.io |
| **uv** | Python 包管理 + 虚拟环境 | https://docs.astral.sh/uv |

---

## 二、核心架构图

```text
=====================================================================================
                          1. Client Layer (前端展现层)
=====================================================================================
    📱 Mobile (响应式)                               💻 Web Desktop
 Tab Bar / 卡片滑动 / 全屏对话                     NavRail / 三栏布局 / Trace 监控
 停留时长追踪 (Visibility API)                      键盘导航 / Command Palette
          |                                               |
          +-----------------------+-----------------------+
                                  |
                      SSE (AG-UI Protocol)
                      CopilotKit (Chat UI)
                                  |
                                  v
=====================================================================================
                         2. BFF Layer (数据 + 透传层)
=====================================================================================
                          [ Next.js 15 App Router ]
                                  |
          +-----------+-----------+-----------+-----------+
          |           |           |           |           |
    [ Data API ]   [ Sources ]  [ Settings ] [ Attention ]
    /api/items     /api/sources /api/settings /api/attention
    /api/raw-items /api/runs    (AES-GCM)    /snapshot
    /api/agent/*   /api/cron/*
          |
          | 职责边界:
          | - DB CRUD (Drizzle ORM + D1)
          | - Auth (Bearer token)
          | - SSE 透传 (不做 LLM 推理)
          | - Cron 调度触发
          |
          | SSE passthrough (AG-UI events)
          v
=====================================================================================
                         3. Agent Layer (智能体运行时)
=====================================================================================
               [ Python FastAPI + LangGraph + AG-UI ]
                                  |
    +------------+----------------+----------------+-----------------+
    |            |                |                |                 |
[ Collectors ] [ LangGraph ]   [ Tools ]      [ Endpoints ]
  ├─ HN         ReAct agent     ├─ evaluate    /agent/chat (AG-UI)
  ├─ HTTP       loop + state    ├─ web_search  /ingest
  ├─ RSS        management      ├─ github      /evaluate
  └─ Grok(X)                    └─ search      /test-collect
                                               /source-types
          |
          | ag-ui-langgraph 桥接
          | LangGraph 事件 → AG-UI 事件 (自动转换)
          v
=====================================================================================
                         4. Data Storage (持久化层)
=====================================================================================
                             [ Drizzle ORM ]
                                  |
                       [ Cloudflare D1 (SQLite) ]
                                  |
    +----------+----------+----------+----------+----------+
    |          |          |          |          |          |
 sources   raw_items    items    user_states  runs     llm_settings
 (配置)    (原始内容)  (评判后)   (行为追踪)  (执行记录) (LLM配置)
           +run_id     +grade    +dwell_ms              +加密API key
=====================================================================================

* 外部触发: ⏰ Cron Triggers → /api/cron/radar/ingest → /api/cron/radar/evaluate
* 配置优先级: env var > DB (测试环境覆盖生产)
* 状态归属: 所有持久化状态在 BFF DB，Agent Server 无状态
```

---

## 三、职责边界

### BFF (Next.js) — 不做推理

| 做 | 不做 |
|----|------|
| DB CRUD (items, sources, runs, chat) | LLM 调用 |
| Auth + session 管理 | Tool 执行 |
| SSE 透传 (Agent → 前端) | Agent 编排逻辑 |
| Cron 调度触发 | Prompt 拼接 |
| 静态资源 + UI 渲染 | 评判/推荐决策 |

### Agent Server (Python) — 不存状态

| 做 | 不做 |
|----|------|
| Chat 对话 (LangGraph agent loop) | 持久化存储 |
| Evaluate pipeline (LLM 评判筛选) | 用户 auth |
| Ingest pipeline (爬虫采集) | Session 管理 |
| Tool 执行 (evaluate, web_search, github, search) | 前端渲染 |
| AG-UI 事件流生成 (via ag-ui-langgraph) | DB schema 管理 |

---

## 四、通信协议

### AG-UI Protocol (Agent ↔ 前端)

```text
CopilotKit (前端)
    ↕ SSE (AG-UI events)
BFF /api/agent/chat (SSE passthrough)
    ↕ SSE (AG-UI events)
Python Agent (ag-ui-langgraph → LangGraph → LangChain)
```

核心事件类型：

| 类别 | 事件 | 用途 |
|------|------|------|
| 生命周期 | RUN_STARTED, RUN_FINISHED, RUN_ERROR | Agent 执行开始/结束/失败 |
| 步骤 | STEP_STARTED, STEP_FINISHED | 多步推理的每一步 |
| 文本 | TEXT_MESSAGE_START/CONTENT/END | 流式文本输出 |
| 工具 | TOOL_CALL_START/ARGS/END/RESULT | Tool calling 全流程 |
| 状态 | STATE_SNAPSHOT, STATE_DELTA | Agent 内部状态同步 |

### Pipeline API (独立)

Ingest / Evaluate 等长时间 pipeline 保持独立 REST + SSE 端点。
当 Agent 在对话中调用 evaluate 时，走 LangGraph tool → 内部执行 pipeline → 结果通过 TOOL_CALL_RESULT 返回。

---

## 五、数据流

### 1. Chat（对话）— LangGraph Agent

```text
CopilotKit (useAgent / <CopilotChat>)
    → BFF /api/agent/chat (SSE passthrough)
    → Python /agent/chat
        → LangGraph ReAct agent (LangChain LLM + tools)
        → ag-ui-langgraph 自动转换事件
    ← AG-UI SSE events
    ← CopilotKit 渲染消息 + trace
```

### 2. Ingestion（采集）— 确定性脚本，不涉及 LLM

```text
sources 表 (D1)
   | BFF 读 enabled sources
   v
POST Python /ingest {sources: [{id, source_type, config}]}
   | 按 source_type 分发 Collector
   v
POST /api/raw-items/batch → D1 raw_items
```

### 3. Intelligence（评判）— Agent tool 或独立触发

```text
方式 A: 用户对话触发
  用户: "帮我评判"
    → LangGraph agent 决定调用 evaluate tool
    → tool 内部执行 pipeline
    → 结果通过 AG-UI TOOL_CALL_RESULT 返回对话

方式 B: Cron / 手动触发
  POST /api/cron/radar/evaluate → Python /evaluate
    → 独立 SSE pipeline (不走 AG-UI)
```

### 4. 隐式追踪

```text
用户点击 item → 自动 PATCH status=watching
停留计时 (Visibility API) → 离开时 sendBeacon dwell_ms
发送 chat 消息 → 自动升级 status=discussed
```

### 5. 认知镜像

```text
GET /api/attention/snapshot
   → 按 source 聚合: consumed×1 + watching×2 + chat_rounds×3
   → actual_weight vs expected_weight
   → 偏差可视化 (AttentionView)
```

---

## 六、Collector 统一接口

```python
class Collector(Protocol):
    async def collect(self, config: dict) -> list[RawCollectorItem]

RawCollectorItem = {external_id, title, url, raw_payload}
```

| Collector | 采集方式 | 需要 API Key |
|-----------|---------|-------------|
| HNCollector | HN Firebase API | 否 |
| HttpCollector | 通用 REST API (config: url + mapping) | 按需 |
| RssCollector | RSS/Atom feed (feedparser) | 否 |
| GrokCollector | Grok API x_search (Twitter/X) | 是 (GROK_API_KEY) |

---

## 七、配置管理

```
读取优先级: env var > DB > defaults

测试环境: .env 文件 (agents/radar/.env)
生产环境: D1 llm_settings 表 (API key 用 AES-256-GCM 加密)
          Cloudflare Pages env vars / Fly.io secrets
```

---

## 八、演进路径

```
Phase 1（当前）：LangGraph 单 Agent + AG-UI + CopilotKit
  → ReAct agent loop (chat + tool calling)
  → AG-UI 事件协议连接前后端
  → 学习：LangGraph state, tool calling, AG-UI 协议

Phase 2（多 Agent）：LangGraph 图编排
  → 多节点图 (路由 agent → 专家 agent)
  → Checkpoint + human-in-the-loop
  → AG-UI STATE_SNAPSHOT/DELTA 状态同步

Phase 3（成熟期）：自建编排
  → 基于实践经验抽象自己的编排层
  → 不依赖特定框架
```
