# 技术栈 (Tech Stack)

## Control Plane (Next.js)

| 需求场景 | 技术选型 | 选型理由 |
| :--- | :--- | :--- |
| **数据库 ORM** | `drizzle-orm` + `drizzle-kit` | 原生支持 Cloudflare D1，端到端类型安全与迁移管理 |
| **大模型通信** | `ai` + `@ai-sdk/openai` | SSE 流式响应、网络重连、乐观 UI 状态 |
| **手势交互** | `framer-motion` | 移动端卡片滑动，物理阻尼，规避 iOS Safari 侧滑 |
| **API 校验** | `zod` | 前后端统一强校验，source_type enum 验证 |
| **API Key 加密** | Web Crypto API (AES-256-GCM) | Edge runtime 原生支持，API key 加密落库 |
| **停留时长追踪** | Page Visibility API + `sendBeacon` | 精准计时（排除后台），页面卸载时可靠上报 |
| **E2E 测试** | `@playwright/test` | 录屏 + trace + 视觉审计（DOM 规则检查） |
| **单元测试** | `vitest` | 快速，ESM 原生支持 |
| **定时任务** | Cloudflare Cron Triggers | 零运维定时调度 |

## Data Plane (Python)

| 需求场景 | 技术选型 | 选型理由 |
| :--- | :--- | :--- |
| **HTTP 服务** | `FastAPI` | 异步，SSE streaming，OpenAPI 自动文档 |
| **HTTP 客户端** | `httpx` | 异步支持，代理配置，trust_env 控制 |
| **LLM 集成** | `langchain` + `langchain-openai` | 链式组合，所有 provider 走 OpenAI-compatible API |
| **RSS 解析** | `feedparser` | 标准 RSS/Atom 解析 |
| **配置管理** | `pydantic-settings` | 类型安全的 env var 加载 + 生产校验 |
| **代码质量** | `ruff` | lint + format 一体，py312 target |
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
