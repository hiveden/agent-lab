# CopilotKit 主题桥接：排查、反思与设计

## 问题排查

### 现象

Chat 区域（CopilotChat 组件）的视觉风格与项目整体 design system 割裂：冷灰色调 vs 暖中性色调、系统字体 vs IBM Plex Sans、16px vs 13px 字号、冷色滚动条 vs 暖色滚动条。

### 根因

CopilotKit v2 是**设计系统完备的组件库**——自带完整的 Tailwind v4 构建产物，在 `[data-copilotkit]` 作用域内定义了一整套 shadcn-like CSS 变量。项目也使用 shadcn/ui，两者选择了**相同的变量命名契约**（`--background`, `--border`, `--accent`, `--primary` 等），但赋了不同的值。

```
项目:       :root { --accent: #4f46e5; --border: #ebe8e2; }     ← 暖色、indigo
CopilotKit: [data-copilotkit] { --accent: oklch(97% 0 0); }     ← 冷灰
```

CSS 特异性：`[data-copilotkit]` > `:root`。CopilotKit 的冷灰值必然覆盖项目的暖灰值。这不是 bug，是 CSS 级联的确定性行为。

### 变量碰撞对照表

| 变量 | 项目值（暖色调） | CopilotKit 覆盖值（冷灰） |
|------|-----------------|--------------------------|
| `--background` | `#fbfaf8` | `oklch(100% 0 0)` 纯白 |
| `--border` | `#ebe8e2` 暖灰 | `oklch(92.2% 0 0)` 冷灰 |
| `--accent` | `#4f46e5` indigo | `oklch(97% 0 0)` 浅灰 |
| `--primary` | `#4f46e5` indigo | `oklch(20.5% 0 0)` 近黑 |
| `--ring` | `#4f46e5` indigo | `oklch(70.8% 0 0)` 中灰 |
| `--muted-foreground` | `#858792` | `oklch(55.6% 0 0)` 冷灰 |

## 反思

### 不是 CSS 架构设计问题

项目的 CSS 架构（design tokens → shadcn bridge → Tailwind v4 utilities）本身没有缺陷，对项目自身组件工作正常。

### 是 CopilotKit 集成工作未完成

任何「设计系统完备」的第三方组件库接入时，都需要做**主题桥接**——把宿主的 design tokens 映射到库的变量命名空间里。这是集成工作的固有步骤，不是架构层面需要重新设计的问题。

完整的集成工作清单：

1. 装包、配置 Provider → **功能接入** ✅
2. 替换组件树、打通数据流 → **功能验证** ✅
3. 项目 design tokens → 库的变量命名空间 → **主题桥接** ❌ 缺失
4. 清理被替换掉的旧 Chat CSS → **迁移收尾** ❌ 缺失

CopilotKit 的 `[data-copilotkit]` 作用域隔离是合理的防御性设计——它期望宿主来覆盖这些变量。问题出在宿主侧没有完成对接。

### 附带暴露的 globals.css 问题

`globals.css` 800+ 行混合了 7 个关注点（tokens、resets、旧 Chat 死代码、trace、sources、runs、attention），用注释分隔不等于分离。CopilotKit 桥接如果也加在这个文件里，架构意图不可见。

**原则：用文件边界表达架构意图。** CSS 缺乏类型系统和模块化能力，文件名是它唯一的结构化文档。

## 设计方案

### 主题桥接：独立文件

创建 `copilotkit-theme.css`，集中处理项目 tokens → CopilotKit scope 的映射：

```css
/* copilotkit-theme.css — 项目 design tokens → CopilotKit scope */
[data-copilotkit] {
  --background: var(--bg);
  --foreground: var(--text);
  --border: var(--border);
  --primary: var(--accent);
  --primary-foreground: #fff;
  --accent: var(--accent-ui);
  --accent-foreground: var(--text);
  --ring: var(--accent);
  --muted: var(--bg-sunk);
  --muted-foreground: var(--text-3);
  --card: var(--surface);
  --card-foreground: var(--text);
  --popover: var(--surface);
  --popover-foreground: var(--text);
  --input: var(--border);
  --destructive: var(--danger);
  --destructive-foreground: #fff;
  --secondary: var(--bg-sunk);
  --secondary-foreground: var(--text);
  /* 字体 + 字号对齐 */
  /* 滚动条对齐 */
  /* dark mode 映射 */
}
```

在入口处 import：

```css
@import './copilotkit-theme.css';
```

### 模式可复用

如果将来接入 Clerk、Stripe Elements 等设计系统完备的组件库，同样模式：`clerk-theme.css`、`stripe-theme.css`。删除集成时，删一个文件 + 一行 import。

### 迁移收尾

清理 `globals.css` 中的旧 Chat 死代码（`.msg`, `.msg-bubble`, `.input-row`, `.send-btn`, `.chat-markdown`, `.tool-card` 等，约 L354-477）。

## 参考

- `docs/13-CHAT-STYLING-PLAN.md` — 原始样式方案（Step 3 已过时，本文档替代）
- `docs/14-TAILWIND-V4-MIGRATION.md` — Tailwind v4 迁移记录
- CopilotKit v2 CSS 源码：`node_modules/@copilotkit/react-core/dist/v2/index.css`
