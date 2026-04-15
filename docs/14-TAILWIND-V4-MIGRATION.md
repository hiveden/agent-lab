# Tailwind v3 → v4 迁移清单

> 基于 [官方升级指南](https://tailwindcss.com/docs/upgrade-guide) 和社区反馈整理
>
> **核心教训**：v4 最重要的架构变化是用 CSS `@layer` 管理优先级。unlayered 样式 > `@layer utilities`。项目中任何不在 `@layer` 中的通配符 reset（如 `* { margin: 0; padding: 0; }`）都会压死所有 Tailwind spacing utility。**升级前必须先通读此文档所有 breaking changes，再动手。**

## 影响项目的 Breaking Changes

### 1. 默认值重命名（shadow / rounded / blur）

v4 将无后缀的值重命名为 `-sm`，原 `-sm` 重命名为 `-xs`：

| v3 | v4 | 说明 |
|---|---|---|
| `rounded-sm` | `rounded-xs` | 原来的小圆角 |
| `rounded` | `rounded-sm` | 原来的默认圆角 |
| `shadow-sm` | `shadow-xs` | 原来的小阴影 |
| `shadow` | `shadow-sm` | 原来的默认阴影 |
| `blur-sm` | `blur-xs` | |
| `blur` | `blur-sm` | |
| `drop-shadow-sm` | `drop-shadow-xs` | |
| `drop-shadow` | `drop-shadow-sm` | |

**处理方式**：批量 sed 替换。

### 2. 默认 border-color 变化

- v3: `border` 默认 `border-color: gray-200`
- v4: `border` 默认 `border-color: currentColor`

**处理方式**：在 `@layer base` 中重置为项目的 `--border` 变量。

### 3. 默认 ring 宽度变化

- v3: `ring` = 3px
- v4: `ring` = 1px

**处理方式**：有 `ring` 的地方改为 `ring-3`，或不处理（项目较少用 ring）。

### 4. button cursor 变化

- v3: `cursor: pointer`（preflight 设置）
- v4: `cursor: default`（浏览器默认）

**处理方式**：在 `@layer base` 中恢复。

### 5. space-* / divide-* 选择器变化

- v3: `> :not([hidden]) ~ :not([hidden])` → margin-top
- v4: `> :not(:last-child)` → margin-bottom

**处理方式**：检查用到 `space-*` 的地方是否有视觉差异。推荐用 `gap-*` 替代。

### 6. hover 变为 media query 保护

- v4: `@media (hover: hover)` 包裹 hover 变体
- 移动端不再触发 hover

**处理方式**：检查移动端交互。

### 7. variant 叠加顺序反转

- v3: `first:*:pt-0`（右到左）
- v4: `*:first:pt-0`（左到右）

**处理方式**：grep 检查有无用到叠加 variant。

### 8. 自定义 @layer utilities 不再自动检测

- v4 需要用 `@utility` 指令

**处理方式**：检查 globals.css 中的 `@layer utilities` 块。

### 9. outline 变化

- `outline-none` → 设置 `outline-style: none`（v3 是 `2px solid transparent`）
- 用 `outline-hidden` 恢复 v3 行为

### 10. 已移除的 opacity utilities

`bg-opacity-*` / `text-opacity-*` 等被移除，改用 `/50` 修饰符语法。

## 执行计划

### Step 1: globals.css 基础修复

```css
@layer base {
  /* 恢复 v3 border 默认行为 */
  *, ::after, ::before, ::backdrop, ::file-selector-button {
    border-color: var(--border, currentcolor);
  }
  /* 恢复 v3 button cursor */
  button:not(:disabled), [role="button"]:not(:disabled) {
    cursor: pointer;
  }
}
```

### Step 2: 批量 rename（sed）

```bash
# rounded 重命名
find apps/web/src -name '*.tsx' -exec sed -i '' \
  -e 's/\brounded-sm\b/rounded-xs/g' \
  -e 's/\brounded\b/rounded-sm/g' {} +
# 但要注意 rounded-sm 已被第一步替换成 rounded-xs
# 所以顺序：先 rounded-sm→rounded-xs，再 rounded→rounded-sm
# 但 rounded-md / rounded-lg / rounded-full 不变

# shadow 重命名
find apps/web/src -name '*.tsx' -exec sed -i '' \
  -e 's/\bshadow-sm\b/shadow-xs/g' \
  -e 's/\bshadow\b/shadow-sm/g' {} +
```

### Step 3: 检查并修复其他变更

- grep `ring ` / `ring-` 检查 ring 宽度
- grep `outline-none` 检查 outline
- grep `space-` 检查 space 选择器影响
- grep `bg-opacity\|text-opacity` 检查已移除的 utility
- grep `first:\*\|last:\*` 检查 variant 顺序

### Step 4: E2E 测试验证

跑 `styles.spec.ts` + 现有 `consumption.spec.ts` visual-audit。

---

## 实际迁移记录

### 根因

项目 globals.css 中的通配符 reset：

```css
/* 这是 unlayered 的 — v4 中优先级高于所有 @layer 内的 utility */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
```

Tailwind v4 的 utility classes（`p-4`, `m-2`, `gap-3` 等）生成在 `@layer utilities` 中。CSS 规范中 unlayered 样式优先级 > 任何 `@layer` 内的样式。所以 `margin: 0; padding: 0` 压死了所有 spacing utility。

### 修复

一行：把通配符 reset 移入 `@layer base`：

```css
@layer base {
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
}
```

### 同时做的修复

1. `@theme` 中注册项目 25 个 design tokens（`--color-text-2`, `--color-surface-hi` 等）
2. 18 个 TSX 文件中 145 处 `[var(--xxx)]` 替换为 Tailwind v4 theme class（`text-text-2`, `bg-surface-hi` 等）
3. `@layer base` 中恢复 v3 border-color 默认值（`var(--border)` 替代 `currentColor`）
4. `@layer base` 中恢复 button cursor: pointer

### 不需要处理的

项目没有使用任何 v4 renamed utilities（`rounded-sm`, `shadow-sm`, `ring`, `outline-none`, `space-*`, `bg-opacity-*`, variant stacking），所以这些 breaking changes 不影响。

### 验证

`e2e/styles.spec.ts` — 4 个 Playwright computed style 断言全部通过：
- body: IBM Plex Sans, 13px, --text, --bg ✅
- 卡片: --border, --surface, 6px 圆角 ✅
- 文字颜色: --text (标题), --text-2 (摘要) ✅
- 导航栏: --border 边框色 ✅
