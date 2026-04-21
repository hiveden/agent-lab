# 04 · 设计系统代币

> 结束散落的 magic number，建立一套可跨 Shell、跨 view 复用的设计语言。
> 对应决策 Q4（已同意）。

---

## 1. 为什么要做 tokens

当前代码里：
- `py-1.5 px-3.5 rounded-[20px]`（filter chip）
- `w-[200px]`（SessionSidebar）
- `text-[15px] leading-[1.4]`（mobile 正文）
- `py-10 px-4`（空态）
- 颜色 `var(--ag-text)` / `var(--ag-text-2)` / `var(--ag-bg)` / `var(--ag-border)` / `var(--ag-hover)` / `text-text-3` / `border-border-hi` / `text-[#16a34a]` / `text-[#dc2626]` / `text-[var(--clr-bolt,#d97706)]`

**问题**：
1. 同一个"正文次级文字"色在不同文件用 `text-text-2` / `var(--ag-text-2)` / `text-[var(--ag-text-2)]` 三种写法
2. 硬编码像素（200px / 100px / 40px）没有统一阶梯
3. 颜色混用 Tailwind token、CSS var、HEX 字面量
4. 动画时长 `duration-150 / 250 / 100` 随机选

→ 维护成本高，主题切换（暗/亮/未来定制）几乎不可能。

---

## 2. Token 分类

七个 scale，全部定义为 CSS custom properties 在 `globals.css`：

| Scale | 用途 | 数量 |
|---|---|---|
| `--space-*` | 间距 / padding / gap / margin | 10 档 |
| `--font-size-*` | 字号 | 7 档 |
| `--font-weight-*` | 字重 | 4 档 |
| `--line-height-*` | 行高 | 4 档 |
| `--radius-*` | 圆角 | 5 档 |
| `--shadow-*` | 阴影 | 4 档 |
| `--duration-*` | 动效时长 | 4 档 |

另外两套独立 scale：

| Scale | 用途 |
|---|---|
| `--color-*` | 颜色（分语义层和底层） |
| `--z-*` | 层级 z-index |

---

## 3. Space Scale（间距）

基于 4px 步进，覆盖 Mobile 紧凑到 Desktop 舒展：

```css
--space-0:  0;
--space-1:  4px;   /* 微间距（icon 内部） */
--space-2:  8px;   /* 紧凑 gap */
--space-3:  12px;  /* 默认 gap */
--space-4:  16px;  /* 容器内 padding */
--space-5:  24px;  /* 段落间距 */
--space-6:  32px;  /* view 内部 section 间距 */
--space-7:  48px;  /* view 级 padding */
--space-8:  64px;  /* 空态 */
--space-9:  96px;  /* 大 hero */
```

**禁用**：`p-[18px]`、`gap-[14px]`、`px-3.5` 这类 0.5 步进。除了对齐系统 hint（如 kbd 字号）外一律用 scale 值。

---

## 4. Font Scale（字号 + 行高 + 字重）

```css
--font-size-xs:   11px;  /* kbd、timestamp、footnote */
--font-size-sm:   13px;  /* 次级文字、标签 */
--font-size-base: 15px;  /* 正文（Mobile 最小可读） */
--font-size-md:   17px;  /* 正文（iOS 默认） */
--font-size-lg:   20px;  /* 小标题 */
--font-size-xl:   24px;  /* 大标题 */
--font-size-2xl:  32px;  /* hero */

--line-height-tight:   1.2;  /* 标题 */
--line-height-snug:    1.4;  /* UI 文字 */
--line-height-normal:  1.5;  /* 正文 */
--line-height-relaxed: 1.7;  /* 长阅读 */

--font-weight-regular:  400;
--font-weight-medium:   500;
--font-weight-semibold: 600;
--font-weight-bold:     700;
```

### Compact vs Expanded 字号策略

**原则**：同一语义角色在 Compact 比 Expanded 大一档。

| 角色 | Compact | Expanded |
|---|---|---|
| 正文 | `--font-size-base` (15px) | `--font-size-sm` (13px) |
| 标题 | `--font-size-md` (17px) | `--font-size-base` (15px) |
| 次级 | `--font-size-sm` (13px) | `--font-size-xs` (11px) |

Mobile 需要更大字号（iOS HIG 推荐 17pt 正文）；Desktop 信息密度优先。用 container query 或 `useViewport` 在 Surface 层切换 className 即可。

---

## 5. Radius Scale（圆角）

```css
--radius-none: 0;
--radius-sm:   4px;   /* 小 chip、tag */
--radius-md:   8px;   /* 卡片、输入框 */
--radius-lg:   12px;  /* 大卡片、sheet */
--radius-xl:   20px;  /* pill、filter chip */
--radius-full: 9999px; /* 圆形按钮、头像 */
```

---

## 6. Shadow Scale

```css
--shadow-none: 0 0 0 transparent;
--shadow-sm:   0 1px 2px rgba(0,0,0,0.05);
--shadow-md:   0 4px 12px rgba(0,0,0,0.08);
--shadow-lg:   0 8px 24px rgba(0,0,0,0.12);
--shadow-xl:   0 16px 48px rgba(0,0,0,0.16); /* Sheet / modal */
```

---

## 7. Duration + Easing

```css
--duration-instant: 80ms;   /* tap 反馈 */
--duration-fast:    150ms;  /* hover / focus */
--duration-base:    250ms;  /* swipe / slide */
--duration-slow:    400ms;  /* sheet 进入 */

--ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
--ease-entrance: cubic-bezier(0, 0, 0.2, 1);
--ease-exit:     cubic-bezier(0.4, 0, 1, 1);
```

参考 Material motion。Framer Motion 的 `transition={{ duration: 0.25 }}` 用 CSS var 统一。

---

## 8. Color Token（两层）

### 8.1 底层色（primitive）

不直接用，只被语义层引用：

```css
--color-neutral-0:   #ffffff;
--color-neutral-50:  #fafafa;
--color-neutral-100: #f4f4f5;
--color-neutral-200: #e4e4e7;
--color-neutral-400: #a1a1aa;
--color-neutral-600: #52525b;
--color-neutral-900: #18181b;

--color-brand-500: #6366f1;  /* accent */
--color-success-500: #16a34a;
--color-warning-500: #d97706;
--color-danger-500:  #dc2626;
```

### 8.2 语义层（semantic，实际用）

```css
--color-bg:         var(--color-neutral-0);
--color-bg-sunk:    var(--color-neutral-50);
--color-surface:    var(--color-neutral-0);
--color-surface-hi: var(--color-neutral-50);

--color-text:       var(--color-neutral-900);
--color-text-2:     var(--color-neutral-600);
--color-text-3:     var(--color-neutral-400);
--color-text-faint: var(--color-neutral-200);

--color-border:     var(--color-neutral-200);
--color-border-hi:  var(--color-neutral-400);

--color-accent:     var(--color-brand-500);
--color-success:    var(--color-success-500);
--color-warning:    var(--color-warning-500);
--color-danger:     var(--color-danger-500);
```

### 8.3 暗色主题

```css
@media (prefers-color-scheme: dark) {
  :root {
    --color-bg:         var(--color-neutral-900);
    --color-bg-sunk:    #000;
    --color-text:       var(--color-neutral-50);
    /* ... */
  }
}
```

**约束**：
- 组件只消费**语义层**（`var(--color-text)`），绝不直接用底层（`var(--color-neutral-900)`）或字面 HEX
- 迁移期：`--ag-*` 系列做成别名 `--ag-bg: var(--color-bg)`，逐步替换，最终移除

---

## 9. Z-Index Scale

```css
--z-base:      0;
--z-dropdown:  10;
--z-sticky:    20;   /* 顶栏 */
--z-overlay:   30;   /* 页面级蒙层 */
--z-modal:     40;   /* Dialog */
--z-sheet:     50;   /* 底部 Sheet */
--z-toast:     60;   /* Sonner */
--z-tooltip:   70;
```

避免代码里随机写 `z-[999]`。

---

## 10. Tailwind 集成

Tailwind v4 用 `@theme`：

```css
@theme {
  --color-bg: var(--color-bg);
  --spacing-1: var(--space-1);
  --radius-md: var(--radius-md);
  /* ... */
}
```

使用方式：
```tsx
<div className="bg-bg text-text p-space-4 rounded-md" />
```

或保留现有 class 但背后映射 token，渐进迁移。

---

## 11. Storybook / 文档

token 定义后配套：
- 页面 `/design-system`（dev only），可视化展示每档
- `docs/mobile-playbook/04-design-tokens.md`（本文）是权威
- Figma 镜像：导出同名 tokens 给设计对齐（可选）

---

## 12. 迁移策略

**不一次重写**。Step 5（Primitives 抽取）时：
1. 新 Primitives 组件一律使用 token
2. 现有组件就地替换字面量（同一 PR 里用 grep 批改）
3. `--ag-*` 保留为 deprecated 别名 3 个月

**审查规则**（MR 检查）：
- 新代码禁止 `text-[15px]` / `p-[12px]` / `w-[200px]` 字面量
- ESLint 规则：`no-restricted-syntax` 禁止 Tailwind arbitrary value 里的 px 值（除 1px border 等特殊情况）

---

## 13. 验收

- [ ] 七个 scale 全部在 `globals.css` 定义
- [ ] Tailwind v4 `@theme` 映射完成
- [ ] 设计系统展示页可访问
- [ ] 新 Primitives 组件零 magic number
- [ ] 暗色主题切换全局生效
