# 技术栈 (Tech Stack)

> 完整选型表见 [02-ARCHITECTURE.md](./02-ARCHITECTURE.md) 第一节。本文补充选型理由和 Provider 配置。

## Control Plane (Next.js BFF)

| 需求场景 | 技术选型 | 选型理由 |
| :--- | :--- | :--- |
| **数据库 ORM** | `drizzle-orm` + `drizzle-kit` | 原生支持 Cloudflare D1，端到端类型安全与迁移管理 |
| **Agent Chat UI** | `CopilotKit` | AG-UI 协议前端客户端，开箱即用的 Chat 组件 |
| **状态管理** | `zustand` | 1KB，slice pattern，persist middleware |
| **数据请求** | `swr` | Next.js 团队出品，轻量缓存 |
| **UI 组件** | `shadcn/ui` | 源码拷贝不是 npm 依赖，Radix 无障碍，Tailwind 原生 |
| **分栏布局** | `react-resizable-panels` | 拖拽 + touch + keyboard + persist |
| **API 校验** | `zod` | 前后端统一强校验 |
| **API Key 加密** | Web Crypto API (AES-256-GCM) | Edge runtime 原生支持 |
| **停留时长追踪** | Page Visibility API + `sendBeacon` | 精准计时，页面卸载时可靠上报 |
| **E2E 测试** | `@playwright/test` | 录屏 + trace + 视觉审计 |
| **单元测试** | `vitest` | 快速，ESM 原生支持 |
| **定时任务** | Cloudflare Cron Triggers | 零运维定时调度 |

## Agent Layer (Python)

| 需求场景 | 技术选型 | 选型理由 |
| :--- | :--- | :--- |
| **Agent 编排** | `langgraph` | ReAct agent loop，状态图，checkpoint，AG-UI 官方适配 |
| **LLM 抽象** | `langchain` + `langchain-openai` | 多 provider 兼容，tool calling，streaming |
| **Agent 协议** | `ag-ui-protocol` + `ag-ui-langgraph` | AG-UI 事件模型 (Pydantic) + LangGraph 桥接 |
| **HTTP 服务** | `FastAPI` | 异步，SSE streaming，OpenAPI 自动文档 |
| **HTTP 客户端** | `httpx` | 异步支持，代理配置 |
| **RSS 解析** | `feedparser` | 标准 RSS/Atom 解析 |
| **配置管理** | `pydantic-settings` | 类型安全的 env var 加载 |
| **代码质量** | `ruff` | lint + format 一体 |
| **测试** | `pytest` + `pytest-asyncio` + `pytest-httpx` | async collector mock 测试 |

## 多 LLM Provider

所有 provider 走 `ChatOpenAI` (OpenAI-compatible API)，通过 `base_url` + `api_key` 切换：

| Provider | base_url | 用途 |
| :--- | :--- | :--- |
| GLM (智谱) | `open.bigmodel.cn/api/paas/v4` | 默认 LLM |
| Ollama | `localhost:11434/v1` | 本地开发，免费 |
| Gemini (CPA) | `localhost:8317/v1` | CPA 代理 → Google |
| Anthropic (CPA) | `localhost:8317/v1` | CPA 代理 → Anthropic |
| Custom | 任意 | 自定义 OpenAI-compatible 端点 |

## 多 Source Collector

| Collector | 技术 | 外部依赖 |
| :--- | :--- | :--- |
| HN | httpx → HN Firebase API | 无 |
| HTTP (通用) | httpx → 任意 JSON API | 无 |
| RSS | httpx + feedparser | 无 |
| Grok (Twitter/X) | httpx → Grok API x_search | GROK_API_KEY |

## Observability 栈（2026-04-18 上线，详见 [docs/22](./22-OBSERVABILITY-ENTERPRISE.md) / [docker/README.md](../docker/README.md)）

### Python Agent 依赖

| 需求场景 | 技术选型 | 选型理由 |
| :--- | :--- | :--- |
| **结构化日志** | `structlog` | LangChain stdlib logging 兼容, 上下文绑定, OTel processor 自动注 trace_id |
| **OTel runtime** | `opentelemetry-distro` + `opentelemetry-sdk` | 行业标准, vendor-neutral |
| **FastAPI instrument** | `opentelemetry-instrumentation-fastapi` | 自动 traceparent extract + SSE span |
| **HTTP 出站 instrument** | `opentelemetry-instrumentation-httpx` | Platform API / Tavily / Grok 出站自动 trace |
| **LLM auto-instrument** | `traceloop-sdk` (OpenLLMetry) | 30+ LLM provider auto-instrument, LangChain/OpenAI/Anthropic 全覆盖 |
| **LLM trace 后端** | `langfuse` + `langfuse.langchain.CallbackHandler` | prompt/completion/cost/latency, eval + prompt management |
| **错误聚合** | `sentry-sdk[fastapi]` | 自动关联 OTel trace_id, 3 端一致体验 |
| **SOCKS 代理** | `socksio` | ClashX 7890 端口 httpx[socks] 必需 |

### Next.js BFF 依赖

| 需求场景 | 技术选型 | 选型理由 |
| :--- | :--- | :--- |
| **OTel Node runtime** | `@opentelemetry/sdk-node` | Next.js `instrumentation.ts` 钩子原生支持 |
| **auto-instrument Node** | `@opentelemetry/auto-instrumentations-node` | fetch / undici / http / express 自动 trace |
| **OTLP exporter** | `@opentelemetry/exporter-trace-otlp-http` | 推到本地 collector :4318 |
| **Sentry 集成** | `@sentry/nextjs` | server + client 一体, 自动 capture unhandled |

### Browser 依赖

| 需求场景 | 技术选型 | 选型理由 |
| :--- | :--- | :--- |
| **OTel Web SDK** | `@opentelemetry/sdk-trace-web` | 浏览器端 WebTracerProvider + Batch |
| **fetch instrument** | `@opentelemetry/instrumentation-fetch` | 自动 W3C traceparent 注入出站 fetch |
| **document-load instrument** | `@opentelemetry/instrumentation-document-load` | 页面加载 trace 作 root span |
| **async context** | `@opentelemetry/context-zone` | Zone.js 保持异步 context |
| **trace propagation** | `propagateTraceHeaderCorsUrls: [/.*/]` | 让 traceparent 跨域 fetch 也带 |

### Docker 栈

| 栈 | 镜像 | 角色 |
| :--- | :--- | :--- |
| OTel Collector | `otel/opentelemetry-collector-contrib:0.144.0` | 网关 + 双写 |
| SigNoz | `signoz/signoz:v0.119.0` + ClickHouse + ZooKeeper | 通用 trace/log/metric UI |
| Langfuse v3 | `langfuse/langfuse:3` web+worker + PG + ClickHouse + Redis + MinIO | LLM trace + eval + prompt mgmt |
| GlitchTip | `glitchtip/glitchtip:v5.1` + PG + Valkey | 错误聚合 Sentry 协议兼容 |
