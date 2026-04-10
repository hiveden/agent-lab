# 技术栈 (Tech Stack)

| 需求场景 (Requirement) | 技术选型 (Tech/Library) | 选型理由 (Rationale) |
| :--- | :--- | :--- |
| **数据库 ORM** | `drizzle-orm` + `drizzle-kit` | 原生支持 Cloudflare D1，提供端到端类型安全与迁移管理。 |
| **大模型通信** | `ai` + `@ai-sdk/openai` | 接管 SSE 流式响应、网络重连及乐观 UI 状态。 |
| **基础 UI 组件** | `shadcn/ui` (`radix-ui`) | 无头组件设计，内置无障碍 (a11y) 与焦点管理逻辑。 |
| **移动端抽屉** | `vaul` | 解决移动端滚动穿透、虚拟键盘适配与多级高度吸附问题。 |
| **手势交互** | `framer-motion` | 提供物理阻尼，规避 iOS Safari 侧滑冲突。 |
| **图标库** | `lucide-react` | 轻量级，深度对齐 shadcn 生态。 |
| **页面可见性追踪** | `ahooks` (`useDocumentVisibility`) | 剥离应用切后台时间，精准计算用户停留时长。 |
| **数据离线上报** | `navigator.sendBeacon` | 确保页面卸载时隐式行为数据能够可靠送达后端。 |
| **表单状态与校验** | `react-hook-form` + `zod` | 消除受控组件性能开销，实现前后端统一强校验。 |
| **定时任务** | `Cloudflare Cron Triggers` | 原生集成至 Wrangler，零运维成本实现定时任务调度。 |
| **后台异步调度** | FastAPI `BackgroundTasks` | 立即响应防 Serverless 网关超时，后台协程静默执行耗时大模型推理。 |
