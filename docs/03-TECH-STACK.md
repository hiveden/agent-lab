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
