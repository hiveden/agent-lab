# Agent Chat 样式方案

## 问题

CopilotKit CopilotChat 默认样式与项目 design system 不统一：字号 16px vs 项目 13px，系统字体 vs IBM Plex，圆角气泡 vs 紧凑平铺，纯黑白 vs 暖灰色系。streaming 时 markdown 源码短暂闪烁。

## 技术发现

### CopilotKit v2 API（v1.50+）

v2 从 `@copilotkit/react-core/v2` 导入，是 v1 的完整替代：

| v1 | v2 | 说明 |
|---|---|---|
| `useCopilotChatInternal` + `useCoAgent` | `useAgent` | 统一 hook，返回 `AbstractAgent` |
| `useCopilotReadable` | `useAgentContext` | 简化接口 |
| `useCopilotAction` | `useFrontendTool` | Zod schema 参数 |
| `useCoAgentStateRender` | `useRenderTool` / activity messages | tool call 渲染 |
| `CopilotChat` (react-ui) | `CopilotChat` (react-core/v2) | 内置 streamdown |
| react-markdown | **streamdown** | 专为 AI streaming 设计，解决闪烁 |

### 关键约束：v2 CSS 依赖 Tailwind v4

v2 的 JS entry 硬 import 了 `./index.css`（Tailwind v4 `@layer` 语法），项目当前用 Tailwind v3 → **PostCSS 编译失败**。

## 执行计划

### Step 1: Tailwind v3 → v4 升级

前置条件。影响范围：
- `tailwind.config.ts` → `@import "tailwindcss"` in CSS（v4 config-in-CSS）
- `postcss.config.mjs` → 可能需要调整
- `globals.css` → `@tailwind base/components/utilities` 改为 `@import`
- shadcn/ui bridge 变量映射可能需要调整

验证：升级后所有现有页面（Inbox/Sources/Runs/Settings）不 break。

### Step 2: CopilotKit v1 → v2 API 迁移

基于 `docs/COPILOTKIT-V2-MIGRATION.md` 完整迁移指南执行：
- `@copilotkit/react-core/v2` 统一导入
- `useAgent` 替代 `useCopilotChatInternal` + `useCoAgent`（消除内部 API 技术债）
- `useFrontendTool` (Zod schema) 替代 `useCopilotAction`
- `useAgentContext` 替代 `useCopilotReadable`
- `useRenderTool` 通配符渲染器替代 `RenderMessage` prop
- v2 CSS（含 `--cpk-*` 色板）+ 项目 design tokens 覆盖

### Step 3: 样式对齐

v2 CSS 用 `--cpk-*` 变量体系。在 `globals.css` 中将 `--cpk-*` 映射到项目 design tokens：

```css
:root {
  --cpk-primary: var(--accent);
  --cpk-background: var(--surface);
  --cpk-foreground: var(--text);
  /* ... */
}
```

加上字号覆盖对齐项目 13px 基准。

## 参考文档

- `docs/COPILOTKIT-V2-MIGRATION.md` — 完整 v1→v2 API 迁移指南
- `docs/10-COPILOTKIT-REFERENCE.md` — v1 API 参考（将被 v2 替代）
- [CopilotKit v1.50 Release](https://www.copilotkit.ai/blog/copilotkit-v1-50-release-announcement-whats-new-for-agentic-ui-builders)
- [useAgent API](https://docs.copilotkit.ai/reference/hooks/useAgent)
- [streamdown](https://github.com/CopilotKit/streamdown) — AI streaming markdown renderer
