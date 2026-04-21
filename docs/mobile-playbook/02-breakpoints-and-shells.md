# 02 · 断点与 Shell

> 如何用三档断点 + 三种 Shell 组织全尺寸布局。
> 术语参见 [`00-glossary.md`](./00-glossary.md)（breakpoint / viewport / container query / hydration）。

---

## 1. 断点定义

```ts
// lib/hooks/useViewport.ts  (待实现)

export type Viewport = 'compact' | 'medium' | 'expanded';

const BREAKPOINTS = {
  compact:  '(max-width: 767px)',
  medium:   '(min-width: 768px) and (max-width: 1279px)',
  expanded: '(min-width: 1280px)',
} as const;
```

| Class | 宽度 | 典型姿态 |
|---|---|---|
| **compact** | < 768px | iPhone 竖屏（375/390/414）、折叠屏折叠态、小窗分屏 |
| **medium** | 768 – 1279px | iPad 竖屏、iPad Mini 横屏、MacBook 分屏左右各半、折叠屏展开 |
| **expanded** | ≥ 1280px | MacBook 全屏、外接显示器 |

### 为什么是 768 / 1280

- **768**：iPad 竖屏宽度正好 768pt。在此之下一定是手机形态。
- **1280**：笔记本最小主流宽度。再小就要牺牲三栏并排的可读性。
- 与 Tailwind 默认 breakpoint（md=768, xl=1280）对齐，方便写工具类。

### 为什么用 compact/medium/expanded 而非 phone/tablet/desktop

**设备姿态会跨档**：
- iPad Pro 11" 竖屏 = 834pt → medium（不是 tablet 档位就叫 tablet）
- MacBook 分屏左右 = 720pt → compact（桌面电脑但要按手机布局）
- 折叠屏展开 = 673pt → 还算 compact

→ 用**容器尺寸**命名，不固化"设备 = 档位"。这是 Material 3 和 Apple HIG 的共同做法。

---

## 2. SSR 友好的首屏策略

### 当前问题

`useIsMobile()` 初次返回 `undefined`（SSR 不知道浏览器宽度）→ `RadarWorkspace.tsx:322` 渲染空骨架 → hydrate 后 swap 整棵树 → **CLS 爆炸**。

### 方案：UA Hint + 骨架屏 ⚠ 2026-04-21 撤回

> **实际落地**：Step 1 初版实现了 UA Hint SSR 预判（`page.tsx` 读 `Sec-CH-UA-Mobile`
> + `RadarWorkspace` 接 `initialShell` prop），但 Step 2 清理过度设计时撤回。
> 理由：把 `/agents/radar` 从 `○ Static` 变 `ƒ Dynamic`，每次 request 过 Edge；
> **单用户工具对 CLS 优化的边际价值极小**（自己刷次数很少，视觉差一瞬可接受）。
>
> 当前实现：`useViewport()` 不接 `initialShell`，首次返回 `undefined` → `page.tsx`
> 用 `<Suspense fallback={<div className="grid grid-rows-[40px_1fr] h-screen" />}>`
> 包 `<RadarWorkspace />`。路由保持 `○ Static`。
>
> **下一次真考虑再启用的触发条件**：单用户 → 多用户产品化 / 真机测到 CLS > 0.1。

原设计保留如下（作为 Step 7 性能优化或未来多用户时的重启路径）：


```
1. Edge 侧读 Sec-CH-UA-Mobile header 粗略预判 Shell
   → 提供初始 HTML（Mobile 骨架 or Desktop 骨架）
2. 客户端 hydrate 后用 matchMedia 精准判断
   → 如果预判错（罕见），swap Shell，但因骨架屏已占位，CLS 小
3. 骨架屏 = Shell 级占位（顶栏 + TabBar 占位 + 列表 shimmer）
   不是当前的空 <div grid-rows-[40px_1fr]>
```

### 实现要点

```tsx
// app/agents/radar/layout.tsx
export default async function Layout({ children }) {
  const headers = await getHeaders();
  const uaMobile = headers.get('sec-ch-ua-mobile') === '?1';
  const initialShell = uaMobile ? 'compact' : 'expanded'; // 粗预判

  return (
    <ViewportProvider initialShell={initialShell}>
      <ShellSwitch>{children}</ShellSwitch>
    </ViewportProvider>
  );
}
```

`ShellSwitch` 根据 `useViewport()` 值 render 对应 Shell，hydration 时若真实 viewport 与 UA Hint 不符，由 CSS transition 平滑切换而非硬切。

---

## 3. 三种 Shell

### 3.1 MobileShell（compact）

```
┌──────────────────────────┐
│ (无顶栏 - 标题融入 view)   │
├──────────────────────────┤
│                          │
│     主内容（全屏单栏）     │
│                          │
├──────────────────────────┤
│  📥  👁  🪞  ⚡  ⚙        │  ← BottomTabBar（EASY 区）
└──────────────────────────┘
     ↑ 底部抽屉：
     PendingChangesSheet
     SearchSheet (⌘K 替代)
     FiltersSheet
```

**特征**：
- 顶栏省略，标题融入 view header（节省垂直空间）
- TabBar 在底部拇指可达区
- 所有次级 UI 走底部抽屉（`Sheet` primitive）
- 手势：横滑 / 长按 / 下拉刷新

### 3.2 TabletShell（medium）⚠ 2026-04-21 暂未独立实现

> **实际落地**：Step 1 初版创建了 `TabletShell.tsx` 空 wrapper（只是 `<DesktopShell {...props} />`），Step 2 清理过度设计时**删除了该文件**。`viewport === 'medium'` 当前**直接走 DesktopShell**（见 `RadarWorkspace.tsx` 的 Shell 选择逻辑）。
>
> 真正的 TabletShell（NavRail 窄版 + Slide Panel）留待 **Step 6** 做。
> 原因：避免空 wrapper 带来的无意义间接层。

原设计保留如下：


```
┌────┬─────────────────────────────────────┬──────────────┐
│    │                                     │              │
│ Nav│  主内容（70%）                       │ Slide Panel  │
│Rail│  · Inbox 列表                        │ (30%, 可收起)│
│    │  · Item detail                       │ · Chat       │
│ 52 │                                     │ · Trace     │
│ px │                                     │ · Filters   │
│    │                                     │              │
└────┴─────────────────────────────────────┴──────────────┘
```

**特征**：
- 左侧 NavRail 窄版（52px），保留图标
- 主内容 + 可折叠右侧 Slide Panel
- 同时支持触控和外接键盘（iPad Magic Keyboard）
- Command Palette 在软键盘召出时工作

### 3.3 DesktopShell（expanded）

```
┌──────────────────────────────────────────────────────────┐
│ agent-lab / radar                  [⌘K]  125 items   A   │
├────┬──────────────────┬──────────────────────────────────┤
│ 📥 │                  │                                  │
│ 👁 │  列表 / 详情      │  对话 / trace                    │
│ 🪞 │  (resizable)     │  (resizable)                     │
│ ⚡ │                  │                                  │
│ ⚙ │                  │                                  │
└────┴──────────────────┴──────────────────────────────────┘
```

**特征**：
- 保持现状：TopBar + NavRail + react-resizable-panels
- 完整键盘驱动（J/K/W/D/X/T/⌘K/？）
- Command Palette、Trace Drawer 等高密度交互

---

## 4. View 在三档下的表现

以 **InboxView** 为例：

| 层面 | compact | medium | expanded |
|---|---|---|---|
| 布局 | 全屏列表 | 列表 + 右侧 detail panel | 列表 + detail + trace 三栏 |
| 卡片密度 | comfortable（摘要 2 行） | comfortable | compact（摘要 1 行） |
| Filter | 底部 Sheet | 列表顶部 chip | Command Palette |
| 搜索 | 顶部搜索按钮 → 全屏 Sheet | 顶部搜索输入 | ⌘K |
| 选中项 | 路由 `/items/[id]` 全屏 | 右 panel | 右 panel 内嵌 |

**同一个 `InboxView.tsx` 组件**，内部用 `useViewport()` 切换：
```tsx
const vp = useViewport();
return (
  <>
    <InboxList density={vp === 'expanded' ? 'compact' : 'comfortable'} />
    {vp !== 'compact' && <DetailPanel />}
  </>
);
```

---

## 5. Container Query 补充

Shell 决定**大布局**，Component 用 container query 决定**微观响应**。

示例：`ItemCard` 在 Desktop Inbox 300px 宽面板 和 Mobile 全屏 375px 下自动微调：

```css
.item-card-wrapper { container-type: inline-size; }

.item-card .summary { display: block; }
@container (max-width: 320px) {
  .item-card .summary { display: none; }      /* 更紧凑 */
  .item-card .meta { font-size: 11px; }
}
```

**优势**：Shell 不用管 ItemCard 的细节，同一个 `ItemCard` 组件在所有 Shell 下都 OK。

**浏览器支持**：Chrome 105+ / Safari 16+ / Firefox 110+。iOS 15 无支持 → 加 `@supports (container-type: inline-size)` 降级或引 polyfill。

---

## 6. 姿态变化的实时响应

用户把手机横屏、iPad 分屏缩小、折叠屏展开时，Shell 要能**活态切换**。

```ts
useEffect(() => {
  const queries = Object.entries(BREAKPOINTS).map(([k, q]) => ({
    key: k,
    mql: window.matchMedia(q),
  }));
  const update = () => {
    const active = queries.find((q) => q.mql.matches);
    setViewport(active?.key as Viewport);
  };
  update();
  queries.forEach((q) => q.mql.addEventListener('change', update));
  return () => queries.forEach((q) => q.mql.removeEventListener('change', update));
}, []);
```

切换时保留**业务状态**（URL + SWR cache），只重渲染 Shell。避免丢失 chat 对话或选中项。

---

## 7. 验收

Step 1（见 [`06-migration-roadmap.md`](./06-migration-roadmap.md)）完成标准：

- [ ] `useViewport` 返回三档正确
- [ ] 三个空 Shell 组件可切换
- [ ] UA Hint 预判生效，Lighthouse CLS ≤ 0.05
- [ ] iPad 竖屏进入 `medium`，不再走 desktop `grid-cols-[52px_1fr]`
- [ ] 横竖屏切换不丢 URL 状态
