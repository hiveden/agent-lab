# CopilotKit 样式定制指南

> 项目使用 CopilotKit v1.55.3 v2 API，自定义暖色 design token 体系。
> 本文档记录样式覆盖的原理、方法、踩坑经验。

## 核心概念：两层样式体系

CopilotKit 的样式分为两层，覆盖方式完全不同：

| 层 | 机制 | 覆盖方式 | 示例 |
|---|---|---|---|
| **颜色/字体** | CSS 变量（`--background`, `--foreground`, `--primary` 等） | 重写变量值 | `--background: var(--bg)` |
| **布局/间距** | 硬编码 `cpk:` Tailwind class（`cpk:py-3`, `cpk:min-h-[50px]`） | CSS 属性覆盖 | `padding-top: 8px` |

**为什么不能只用变量覆盖？**
CopilotKit 不提供布局相关的 CSS 变量（如 `--cpk-input-padding`），间距/高度直接写死在 `cpk:` 前缀的 Tailwind class 里。

## 定制方式：Slot + CSS 覆盖

修改 CopilotKit 组件需要两种手段配合：

| 方式 | 能改什么 | 改不了什么 |
|------|---------|-----------|
| **Slot props** | 组件结构（替换/包装子组件）、最外层 className/style | 内部子元素的 `cpk:` class |
| **CSS 覆盖** | 任何层级的样式，包括 `cpk:` class 的默认值 | 组件结构、行为逻辑 |

**原则：slot 改结构，CSS 改样式。**

### Slot 使用示例

```tsx
<CopilotChat
  agentId="radar"
  // 消息区域：加内边距
  messageView={{
    className: 'px-3 py-2',
    assistantMessage: {
      children: ({ markdownRenderer, toolCallsView, toolbar }) => (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', ... }}>
          {markdownRenderer}
          {toolCallsView}
          {toolbar}
        </div>
      ),
    },
  }}
  // 输入框：slot style 能设但 cpk: class 可能覆盖
  input={{
    textArea: { style: { fontSize: '13px' } },
  }}
/>
```

**注意**: slot 的 `style` 会生成 inline style，但 CopilotKit 内部 `cpk:` class 的 `!important` 级别可能更高。如果 slot style 不生效，改用 CSS 覆盖。

### CSS 覆盖示例

CSS 覆盖统一放在 `copilotkit-theme.css`，选择器优先用 `data-*` 属性，避免转义 `cpk:` class 名：

```css
/* ✅ 推荐：data 属性选择器，稳定 */
[data-copilotkit] [data-testid="copilot-chat-textarea"] { padding: 8px 0; }
[data-copilotkit] [data-layout="compact"] { gap: 4px; }

/* ⚠️ 可用但脆弱：转义 cpk: class 名，版本升级可能变 */
[data-copilotkit] .cpk\:min-h-\[50px\] { min-height: auto; }
```

## 统一覆盖文件：copilotkit-theme.css

所有 CopilotKit 样式覆盖集中在 `apps/web/src/app/copilotkit-theme.css`，通过 `globals.css` 引入：

```css
/* globals.css */
@import 'tailwindcss';
@import './copilotkit-theme.css';
```

文件结构：

```css
/* ── 变量层：颜色/字体对齐 ── */
[data-copilotkit] {
  --background: var(--bg);
  --foreground: var(--text);
  --primary: var(--accent);
  /* ... shadcn 变量 → 项目 design tokens */
  font-family: var(--sans);
  font-size: 13px;
}

/* ── 布局层：间距/高度覆盖 ── */
[data-copilotkit] [data-layout="compact"] { ... }
[data-copilotkit] [data-testid="copilot-chat-textarea"] { ... }

/* ── 滚动条 ── */
[data-copilotkit] ::-webkit-scrollbar { ... }
```

**新增样式覆盖时，都往这个文件加。**

## CopilotChat 组件层级

理解层级才能选对 selector：

```
[data-copilotkit]                         ← Provider 作用域
  └─ CopilotChatView
       ├─ ScrollView                      ← 消息滚动区
       │    └─ .cpk:max-w-3xl.cpk:mx-auto ← 居中容器
       │         └─ MessageView           ← messageView slot
       │              ├─ AssistantMessage  ← [data-message-id="..."]
       │              └─ UserMessage
       ├─ SuggestionView
       └─ CopilotChatInput               ← [data-layout="compact"]
            ├─ 附件按钮                    ← .cpk:h-9
            ├─ textarea                   ← [data-testid="copilot-chat-textarea"]
            │   wrapper: .cpk:min-h-[50px]
            └─ 发送按钮                    ← [data-testid="copilot-send-button"]
```

## Slot 系统详解

每个 slot 接受三种值：

```tsx
// 1. string — 作为 className
<CopilotChat messageView="my-class" />

// 2. Partial<Props> — 覆盖部分 props（可含 className, style, children）
<CopilotChat messageView={{ className: 'px-3', style: { gap: '8px' } }} />

// 3. ComponentType — 整体替换组件
<CopilotChat messageView={MyCustomMessageView} />
```

### assistantMessage.children slot

最常用的 slot——自定义助手消息气泡，同时保留 CopilotKit 的内置渲染器：

```tsx
messageView={{
  assistantMessage: {
    children: ({ markdownRenderer, toolCallsView, toolbar }) => (
      <div className="...">
        {markdownRenderer}   {/* streamdown 流式 markdown */}
        {toolCallsView}      {/* tool call 渲染 */}
        {toolbar}            {/* copy/regenerate/thumbs */}
      </div>
    ),
  },
}}
```

## 常见问题

### slot style 设了但不生效

CopilotKit 内部的 `cpk:` Tailwind class 可能优先级更高。改用 `copilotkit-theme.css` 中的 CSS 属性覆盖。

### 输入框太高

原因：`cpk:min-h-[50px]`（容器最小高度）+ `cpk:py-3`（textarea 上下各 12px padding）。
解决：CSS 覆盖，见 `copilotkit-theme.css` 的"Chat 输入框紧凑化"部分。

### 消息气泡贴边

原因：CopilotKit 默认消息区域用 `cpk:max-w-3xl cpk:mx-auto` 居中限宽，但没有内边距。
解决：`messageView={{ className: 'px-3 py-2' }}` 或 CSS 覆盖。

### 自建 Chat vs CopilotChat

项目 Inbox 页面用自建 ChatView（Vercel AI SDK `useChat` + 自建 `<textarea>` + `.input-row` CSS），Agent 页面用 CopilotChat。两者不能互换：

| | Inbox ChatView | Agent CopilotChat |
|---|---|---|
| 输入框 | 自建 `<textarea>` + `.input-row` | CopilotKit 内部组件 |
| 消息列表 | 自建 `<MessageList>` | CopilotKit `CopilotChatMessageView` |
| 协议 | Vercel AI SDK | AG-UI Protocol |
| 样式控制 | 完全自主 | slot + CSS 覆盖 |

**建议继续用 CopilotChat**——它提供 AG-UI 协议全链路、流式 markdown（streamdown）、Inspector 集成、tool call 渲染。CSS 覆盖的成本远低于自建这些功能。
