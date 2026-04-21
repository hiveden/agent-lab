# 10 · 技术选型 ADR

> **决策集合（Architecture Decision Record）**：基于 2026-04-21 的 8 项并行调研 + 交叉验证形成。
> 每条决策标注证据源。上游输入：8 个调研 agent 的完整输出归档在 `.planning/` / 会话记录。

---

## 调研执行元数据

- **发起**：2026-04-21
- **执行方式**：8 个 general-purpose agent 并行联网调研（WebSearch + WebFetch）
- **交叉验证**：每项结论至少 3 个独立源；agent 之间的结论互相比对，发现 0 个硬冲突
- **人工监工**：结果汇总后检查证据强度、合并风险、沉淀原则
- **本期已决 vs 下期延后**：Apple 开发者账号未就绪 → 原生壳 / iOS APNs 延后到下期（见 [`05-pwa-strategy.md`](./05-pwa-strategy.md)）

---

## 整体技术栈速查

```
┌─────────────────────────────────────────────────────────────┐
│ Chat (AG-UI)                                                │
│   @copilotkit/react-core/v2 · useAgent                      │  ADR-1
├─────────────────────────────────────────────────────────────┤
│ Data Layer                                                  │
│   TanStack Query v5 + @tanstack/query-async-storage-persister│  ADR-2
│   └── IndexedDB: idb-keyval (5 行适配)                       │  ADR-3
│   Zustand: 只保留 UI 偏好 slice（drop server state）          │  ADR-2
├─────────────────────────────────────────────────────────────┤
│ UI Primitives                                                │
│   Sheet / Drawer: shadcn Drawer (Vaul)                      │  ADR-4
│   Virtual List:   @tanstack/react-virtual (headless)        │  ADR-5
│   Gesture:        framer-motion drag（保留）                  │  ADR-5 附
│   Container Query: 原生 + @supports 降级（无 polyfill）       │  ADR-6
├─────────────────────────────────────────────────────────────┤
│ PWA / SW                                                    │
│   @serwist/next (Workbox 封装)                              │  ADR-7
│   Background Sync: Workbox BackgroundSyncPlugin             │  ADR-7
├─────────────────────────────────────────────────────────────┤
│ Web Push (Android 本期，iOS 下期)                             │
│   @block65/webcrypto-web-push · on Cloudflare Edge          │  ADR-8
│   VAPID key: CF Pages secrets                               │  ADR-8
└─────────────────────────────────────────────────────────────┘
```

**Mobile first paint bundle 净增估算**：~50KB gzip（TanStack 13 + Virtual 15 + idb-keyval 1.4 + Vaul 7 + Serwist ~5 + 其他）。命中 [`01-architecture-rfc.md`](./01-architecture-rfc.md) 性能预算 120KB 上限。

---

## ADR-1 · Chat 统一到 AG-UI（`useAgent` v2）

### 决策
采用 **CopilotKit v1.50 推出的 v2 `useAgent` hook**（`@copilotkit/react-core/v2`）作为 Mobile/Desktop 统一 chat 基础设施，替代当前 `MobileChatView` 的 `/api/chat` OpenAI delta 通路。

### 动机
统一 AG-UI Protocol，恢复 trace_id 贯穿 / tool call 可视化 / Langfuse 观测（见 [`01-architecture-rfc.md`](./01-architecture-rfc.md) 6.1）。

### 证据
- 官方文档：[Headless UI](https://docs.copilotkit.ai/langgraph/custom-look-and-feel/headless-ui) + [useAgent reference](https://docs.copilotkit.ai/reference/hooks/useAgent)
- v1.50 发布说明：[blog](https://www.copilotkit.ai/blog/copilotkit-v1-50-release-announcement-whats-new-for-agentic-ui-builders)（2025-12），`useAgent` 是 `useCoAgent` 超集
- AG-UI 17 事件类型在 headless 下全部可消费：[blog](https://www.copilotkit.ai/blog/master-the-17-ag-ui-event-types-for-building-agents-the-right-way)
- 踩坑参照：#2160（render 需手动）、#2274（frontend stop 不能停 backend）、#2872（agentId 不匹配会崩）

### 推荐接入（见 `01-architecture-rfc.md` Step 3）

> **API 签名已由 PoC 脚手架（Worker A）从 `node_modules/.../dist/copilotkit-*.d.mts` 实锤校准（2026-04-21）**。
> 2025-12 v1.50 blog 示例的 `useAgent(id, opts)` 形式在 1.56.2 实际 API 中**不存在**；正确签名只接 1 个 props 对象，且通过 `updates` 数组显式订阅才会 rerender。

```tsx
// apps/web/src/lib/hooks/use-chat-session.ts
import { useMemo, useCallback } from "react";
import { useAgent, UseAgentUpdate } from "@copilotkit/react-core/v2";

// 稳定引用（#32 教训）— 模块级，不要 inline `{}` / `[]` 进 hook 参数
const AGENT_UPDATES = Object.freeze([
  UseAgentUpdate.OnMessagesChanged,
  UseAgentUpdate.OnRunStatusChanged,
  UseAgentUpdate.OnStateChanged,
]) as unknown as UseAgentUpdate[];

function genId() {
  return crypto.randomUUID?.() ?? `msg_${Math.random().toString(36).slice(2)}`;
}

export function useChatSession(agentId: string = "radar", threadId?: string) {
  // useMemo deps=[] 保证 identity 不变
  const agentProps = useMemo(
    () => ({ agentId, threadId, updates: AGENT_UPDATES }),
    [agentId, threadId],
  );
  const { agent } = useAgent(agentProps);

  const sendMessage = useCallback(
    async (text: string) => {
      agent.addMessage({ id: genId(), role: "user", content: text });
      await agent.runAgent();
    },
    [agent],
  );

  const toolCalls = useMemo(() => {
    return (agent.messages ?? []).flatMap(
      (m) => (m as { toolCalls?: unknown[] }).toolCalls ?? [],
    );
  }, [agent.messages]);

  return {
    messages: agent.messages,
    sendMessage,
    isStreaming: agent.isRunning,
    toolCalls,
    state: agent.state,
  };
}
```

**关键**：
- `useAgent(props?)` 只接 1 个参数，返回 `{ agent: AbstractAgent }`
- **必须传 `updates` 数组**，默认空数组 → hook 不触发 rerender，UI 会看起来"假死"
- 发消息走 `agent.addMessage({ id, role, content })` + `agent.runAgent()`，不是 `runAgent({ messages: [...] })`

### 风险 & 待 PoC 验证
- **R1.1 (高)**：v2 API 发布仅 4 个月，breaking change 风险高
- **R1.2 (高)**：`<CopilotKit>` provider 的 `headers` / `properties` 必须稳定引用（issue #32 教训）
- **R1.3 (中)**：`traceparent` 透传走浏览器 OTel `FetchInstrumentation` 的 `propagateTraceHeaderCorsUrls: [/.*/]`，**不需要**手动塞 header（这点 Phase B1 契约审计时已校准，见 `contract-notes.md`）。PoC V3 验证的是这条链是否实际通
- **R1.4 (中)**：frontend `stop()` 只关 UI，Python 侧需实现 `copilotkit_exit()` 或 cancel token
- **R1.5 (新，高)**：`useAgent` 真实签名与 v1.50 官方 blog 示例不符 — 已由 PoC node_modules d.ts 校准（见上方骨架）

**PoC 必测项**（已落地 `poc/copilotkit-v2-useagent/`，2026-04-21 完成验证，VERDICT: ✅ PASS 6/7 + 2 跳过）：
- [x] V1 `useAgent().messages` 流式更新 ✅
- [-] V2 `messages[].toolCalls` streaming 实时可见 — 跳过（共识，ADR-1 决策价值低）
- [x] V3 `traceparent` 透传 ✅ (SigNoz ClickHouse 44 span 三端贯穿实锤)
- [x] V4 Langfuse + SigNoz 三端贯穿 ✅
- [x] V5 SSE 断线重连 ✅ (Playwright 自动化，file=9→162→724 chars)
- [-] V6 Dev Console #32 回归 — 跳过（ADR-9 稳定引用原则已覆盖）
- [x] V7 `isRunning` 翻转时机 ✅ (Playwright 自动化，click→running=20ms)

详见 `poc/copilotkit-v2-useagent/VERDICT.md`。

---

## ADR-2 · 数据层迁移 SWR → TanStack Query v5

### 决策
**全量迁移 SWR 到 TanStack Query v5**，项目 SWR 调用仅 4 个 hook + 1 组件，迁移成本约 1.5 天。保留 Zustand 仅管 UI 偏好 slice（View 选中、panel 尺寸）——**drop Zustand 管 server state 与 Pending queue 的部分，交给 TanStack `useMutation` + `networkMode: 'offlineFirst'`**。

### 动机
Mobile 移动端 5 项诉求中 SWR 在 3 项（**mutation queue / offlineFirst / persist IndexedDB**）上没有官方答案。TanStack 全部是一等公民。

### 证据
- SWR 2.3 Mutation API：[官方文档](https://swr.vercel.app/docs/mutation) — 无 persist / 无 mutation queue / 无 networkMode
- TanStack Query v5 `createPersister` + IndexedDB：[Discussion #6213](https://github.com/TanStack/query/discussions/6213)
- TanStack Network Mode：[官方 guide](https://tanstack.com/query/v5/docs/framework/angular/guides/network-mode)
- 对比博文：[SWR vs TanStack Query 2026](https://dev.to/jake_kim_bd3065a6816799db/swr-vs-tanstack-query-2026-which-react-data-fetching-library-should-you-choose-342c) / [refine.dev 2025 对比](https://refine.dev/blog/react-query-vs-tanstack-query-vs-swr-2025/)

### 能力 gap 证据

| 场景 | SWR 2.3 | TanStack v5 |
|---|---|---|
| Optimistic update | `mutate({optimisticData, rollbackOnError})` ✅ | `useMutation onMutate/onError/onSettled` ✅ |
| Persist cache | **无官方方案** | `createPersister` + 任意 async storage ✅ |
| Mutation queue | **无** | `networkMode: 'offlineFirst'` + `resumePausedMutations` ✅ |
| Offline network mode | 无概念 | `online / always / offlineFirst` 三档 ✅ |
| SW Background Sync 集成 | 纯业务自写 | `onlineManager.setEventListener` 接入点 ⚠ 仍需手写桥接 |

### 风险
- **R2.1 (低)**：SSR hydration 需配合 App Router `HydrationBoundary`（有官方 example）
- **R2.2 (低)**：+8KB gzip bundle（可接受）
- **R2.3 (中)**：SW background sync 与 TanStack mutation queue 的**双队列冲突** — 约定 TanStack 为权威，SW 只回推 online 信号

### 实施
迁移放在 `06-migration-roadmap.md` **Step 0（新增，Step 1 之前）**：
1. 加 `QueryClient` + `QueryClientProvider` 到根 layout（10 行）
2. 4 个 hook 改写（每个 ~5 行）
3. `persistQueryClient` + `idb-keyval` 适配器（30 行）
4. Pending slice 改用 `useMutation` + `offlineFirst`

---

## ADR-3 · IndexedDB 用 idb-keyval

### 决策
**idb-keyval** 作为唯一 IndexedDB 封装，不引入 Dexie / localforage。

### 动机
数据规模 ≤50 pending + ≤1000 items + chat sessions，**全部按 id / key 查，无范围查询、无多索引、无 schema migration 需求**。Dexie 31KB 是纯开销。

### 证据
| 库 | Gzip | 最近 push | 决策 |
|---|---|---|---|
| **idb-keyval** | **1.4 KB** | 2025-05-08 | ✅ 推荐 |
| idb | 3.5 KB | 2025-05-07 | 备选（同作者，更完整） |
| Dexie | 31 KB | 2026-04-19 | 未来数据量超阈值再迁 |
| localforage | 8.7 KB | 2024-07-30（停滞） | ❌ 淘汰 |

源：
- [idb-keyval GitHub](https://github.com/jakearchibald/idb-keyval) — Jake Archibald 维护，Chrome / SW 规范作者
- [BSWEN 2026-04-07 对比](https://docs.bswen.com/blog/2026-04-07-indexeddb-libraries-dexie-idb-rxdb/)
- Bundlephobia 实测

### 适配 TanStack Query persister（5 行）

```ts
// lib/offline/query-persister.ts
import { get, set, del } from 'idb-keyval';
export const idbStorage = {
  getItem: (k: string) => get(k),
  setItem: (k: string, v: unknown) => set(k, v),
  removeItem: (k: string) => del(k),
};
```

### Store 隔离约定
`lib/offline/stores.ts` 集中导出：
```ts
export const PENDING_STORE  = createStore('agent-lab-offline', 'pending');
export const ITEMS_STORE    = createStore('agent-lab-offline', 'items');
export const SESSIONS_STORE = createStore('agent-lab-offline', 'sessions');
```
禁止在业务代码里手写字符串。

### 风险
- **R3.1 (中)**：SSR 不支持，所有使用点必须 `'use client'` + `typeof window !== 'undefined'` guard 或 `dynamic({ ssr: false })`
- **R3.2 (低)**：未来数据量 > 10k 或需要 range query 时需迁 Dexie（预计触发时间：远期）

---

## ADR-4 · Sheet/Drawer 用 shadcn Drawer (Vaul)

### 决策
用 **shadcn/ui Drawer**（基于 Vaul 1.1.2）作为移动端 Sheet primitive。

### 动机
已有 shadcn Dialog 生态，Vaul 底层就是 Radix Dialog，零集成冲突。Vaul 1.1.2 API 冻结，即便作者公告 "unmaintained"，shadcn 主动维护适配层。

### 证据
- [shadcn/ui Drawer 文档](https://ui.shadcn.com/docs/components/drawer) — Responsive Dialog 示例覆盖 Mobile/Desktop 切换
- [Vaul 1.1.2 release](https://github.com/emilkowalski/vaul/releases)（2024-12-14）
- [react-modal-sheet v5.6.0 · 2025-03](https://github.com/Temzasse/react-modal-sheet/releases) — 备选活跃方案

### 对比

| 方案 | Star | 最近更新 | 维护 | iOS Safari | 备注 |
|---|---|---|---|---|---|
| **shadcn Drawer (Vaul)** | 8.3k | 2024-12 | "unmaintained" 但 API 冻结 | 10+ open issue 可 workaround | ✅ 与项目契合 |
| react-modal-sheet | 1.2k | 2025-03 活跃 | 周更 | Virtual Keyboard API 友好 | 备选，API 不同 |
| react-spring-bottom-sheet | 1.06k | 长期停滞 | ❌ | 老代码 | 淘汰 |
| 自研 framer-motion | — | — | 自维护 | 自测 | ROI 低，a11y 要重写 |

### 已知坑 & Workaround
- **iOS scroll bleed (#641)**：`body { overflow: hidden; overscroll-behavior: contain }`
- **iOS input 跳动 (#619/#620)**：PendingChangesSheet 含 input 时 `repositionInputs={false}` 自管 safe-area
- **滚动冲突 (#575)**：内容容器标 `data-vaul-no-drag`
- **React 19 peer warning (#591)**：`pnpm.overrides` 放宽 peer

### 风险
- **R4.1 (中)**：Vaul 停维护公告，若出现 React 20+ 破坏性变更需自 patch（API 冻结 = 低概率）
- **R4.2 (低)**：若 iOS 键盘交互严重 bug 不可 workaround → 4 个调用点迁 react-modal-sheet（API shape 不同但可控）

### 接入
`pnpm dlx shadcn@latest add drawer` → 自动拉 vaul + 写入 `components/ui/drawer.tsx`

---

## ADR-5 · 虚拟滚动用 @tanstack/react-virtual

### 决策
**@tanstack/react-virtual** 作为 Inbox 列表虚拟滚动方案。保留 framer-motion drag 手势（不换 `@use-gesture/react`，避免重写 swipe 逻辑）。

### 动机
headless + framer-motion 有官方社区验证的 `AnimatePresence` 每项独立集成方案。agent-lab 需同时保留：swipe drag + exit 动画 + container query + IntersectionObserver Dwell tracker —— headless 是唯一不会踩边界的选择。

### 证据
- [TanStack Virtual + Motion 官方级教程](https://www.devas.life/how-to-animate-a-tanstack-virtual-list-with-motion/) — exit 动画 + layout 打架的解决模式
- [TanStack iOS issue #884](https://github.com/TanStack/virtual/issues/884) — 仅 `useWindowVirtualizer + dynamic height` 触发 momentum 中断；**agent-lab 用 container scroll 模式天然规避**
- [react-virtuoso iOS 多个未修 bug](https://github.com/petyosi/react-virtuoso/issues/945) — 稳定性劣势
- [react-window v2 API 破坏](https://github.com/bvaughn/react-window/issues/302) — 生态断层
- [npmtrends 周下载对比](https://npmtrends.com/@tanstack/virtual-core-vs-react-virtualized-vs-react-virtuoso-vs-react-window) — TanStack 11.7M vs Virtuoso 2.2M

### 对比

| 库 | Gzip | 动态高度 | AnimatePresence 兼容 | iOS 触控 | 备注 |
|---|---|---|---|---|---|
| **@tanstack/react-virtual** | **10–15 KB** | `measureElement` + ResizeObserver | 每 item 独立 `AnimatePresence` ✅ | container 模式稳 | ✅ 推荐 |
| react-virtuoso | 25–30 KB | 全自动（黑盒）| 与内部测量冲突 | 多个未修 bug | 次选 |
| react-window | 6 KB | v2 `useDynamicRowHeight`（效率差）| 无官方方案 | v2 API 变动 | 淘汰 |

### 关键实现约束
1. **不用 `layout` 动画**：用 `height` + `opacity` 代替（ResizeObserver 会把 transform 中间态当真高度）
2. **drag 时暂停测量**：drag 开始 `setIsDragging(true)`，drag 中不 update items 数组
3. **合理 `estimateSize`**：初始给 120px，首屏偏差不影响可用性
4. **用 container scroll 模式**（非 window scroll）：规避 iOS #884 momentum 问题

### 风险
- **R5.1 (中)**：`layout` 动画与 ResizeObserver 冲突 → 用 height/opacity 替代
- **R5.2 (中)**：drag 过程相邻项 measure 抖动 → dragging 卡片 `position: absolute` 脱流
- **R5.3 (低)**：1000+ 条首屏逐项 measure 成本 → estimateSize 兜底

---

## ADR-6 · Container Query 原生 + @supports 降级

### 决策
**方案 A · 原生 Container Query + `@supports not()` 降级**。不引入 polyfill，基线要求 iOS 16+ / Chrome 106+ / Firefox 110+。

### 动机
- 全球原生支持率 94.05%（caniuse 2025-04）
- iOS 15 及以下份额 ≈ 3.1% 且持续下降
- Polyfill 9KB gzip + MutationObserver/ResizeObserver 运行时开销 + 已 2022-11 进入 maintenance mode
- agent-lab 是**个人单用户工具**，用户自控设备，ROI 论证简单

### 证据
- [caniuse/css-container-queries](https://caniuse.com/css-container-queries) — 94.05%
- [Statcounter iOS Version Market Share](https://gs.statcounter.com/ios-version-market-share/) — iOS 15 <3.1%
- [GoogleChromeLabs/container-query-polyfill](https://github.com/GoogleChromeLabs/container-query-polyfill) — 9KB, maintenance mode

### 实施

```css
/* ItemCard 父容器 */
.item-card-host {
  container-type: inline-size;
  container-name: card;
}
@container card (width < 360px) {
  .item-card { padding: 8px; font-size: 13px; }
  .item-card__meta { display: none; }
}

/* 不支持时降级紧凑样式（宁可紧凑不可错乱） */
@supports not (container-type: inline-size) {
  .item-card { padding: 8px; font-size: 13px; }
  .item-card__meta { display: none; }
}
```

`.browserslistrc`：
```
iOS >= 16
Chrome >= 106
Firefox >= 110
Safari >= 16
```

### 风险
- **R6.1 (低)**：iOS 15 用户会看到"全紧凑"版，视觉不够好但功能完整。用户自控设备 → 可接受

### 备案
若未来某场景必须支持 iOS 15，用动态 `import()` 按 UA 命中加载 polyfill，9KB 只付费给 3% 用户。**当前不做**。

---

## ADR-7 · PWA / SW 用 @serwist/next

### 决策
**@serwist/next** 作为 Next.js 15 App Router 的 PWA 集成方案，替代 next-pwa。

### 动机
- next-pwa 自 2024-01 起**27 个月零 commit + 139 open issues**
- Serwist 由 next-pwa 原作者参与，2026-03-14 发 v9.5.7，peer 明确 `next >= 14.0.0`
- 官方文档首页即分 webpack / Turbopack 两路径
- 与 Cloudflare Pages 兼容性已有社区多篇 2024 blog 验证

### 证据
- [serwist/serwist GitHub](https://github.com/serwist/serwist) — 1398★，open issues 仅 8
- [shadowwalker/next-pwa](https://github.com/shadowwalker/next-pwa) — 4087★，open issues 139，最后 commit 2024-01
- [Serwist Next.js quick guide](https://serwist.pages.dev/docs/next/getting-started) — App Router 原生支持
- [Serwist issue #54](https://github.com/serwist/serwist/issues/54) — Turbopack dev 未支持（open），生产构建不受影响

### 接入骨架

```ts
// next.config.ts
import withSerwist from '@serwist/next';
export default withSerwist({ swSrc: 'app/sw.ts', swDest: 'public/sw.js' })(config);

// app/sw.ts
import { Serwist } from 'serwist';
import { defaultCache } from '@serwist/next/worker';
new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  runtimeCaching: [
    { urlPattern: /^\/api\/agent\/chat/, handler: 'NetworkOnly' },  // SSE 禁缓存
    { urlPattern: /^\/api\/(items|runs)/, handler: 'StaleWhileRevalidate' },
    { urlPattern: /^\/_next\/static/,     handler: 'CacheFirst' },
    ...defaultCache,
  ],
}).addEventListeners();
```

### Cloudflare Pages 特殊注意

1. **`_headers` 必配** `/sw.js` 的 `Cache-Control: no-cache` + `Service-Worker-Allowed: /`
2. **排除 SSE 路由**：`/api/agent/chat` 必须 `NetworkOnly`（否则 SW 缓冲 SSE 流导致对话卡住）
3. **`@cloudflare/next-on-pages` 兼容**：Serwist build 阶段产出 `sw.js`，与 Edge Functions 转换解耦，无冲突

### 风险
- **R7.1 (中)**：Turbopack dev 下 SW 自动禁用；生产 build 仍 webpack，不受影响。**项目当前 `pnpm dev:web` 未用 Turbopack**
- **R7.2 (中)**：Serwist 社区体量 1.4k★，偏门 bug 自修 patch。主流需求（cache / sync / push）无阻塞
- **R7.3 (中)**：SW 更新策略 — 配 `reloadOnOnline: true` + UI toast 提示"新版本可用"
- **R7.4 (中)**：TanStack cache 与 SW cache 双层过期 → mutation 后 `caches.delete(...)` 或 API 改 `NetworkFirst`

---

## ADR-8 · Web Push 用 @block65/webcrypto-web-push on Edge

### 决策
**`@block65/webcrypto-web-push` + Cloudflare Pages Functions (Edge Runtime)** 作为 Web Push 后端。VAPID key 放 CF Pages secrets。**不引入 Python pywebpush**。

### 动机
- 触发源（新 fire item / Run 完成）**本来就在 BFF**，Agent Server 只做 LLM 推理（CLAUDE.md 架构原则）
- `web-push` npm 库依赖 Node `crypto`，在 Workers 社区答复"unreliable, use Web Crypto"
- `@block65/webcrypto-web-push` 纯 Web Crypto，**官方 `examples/cloudflare-workers/` 有 Hono + D1 + Drizzle 完整 demo**，与 agent-lab 技术栈零距离

### 证据
- [block65/webcrypto-web-push GitHub](https://github.com/block65/webcrypto-web-push) — v1.0.2 (2024-12)
- [CF Workers 官方 demo main.ts](https://github.com/block65/webcrypto-web-push/blob/master/examples/cloudflare-workers/main.ts)
- [web-push issue #718 "Cloudflare Worker support?"](https://github.com/web-push-libs/web-push/issues/718) — 长期未关
- [CF Community: web-push in Pages Functions](https://community.cloudflare.com/t/id-like-to-use-the-npm-library-web-push-in-my-functions/664306) — 官方答复"use Web Crypto"
- [CF Agents push guide](https://developers.cloudflare.com/agents/guides/push-notifications/)

### 接入骨架

```ts
// apps/web/src/app/api/push/send/route.ts
import { buildPushPayload } from '@block65/webcrypto-web-push';
export const runtime = 'edge';

export async function POST(req: Request) {
  const { env } = getRequestContext();
  const subs = await db.select().from(subscriptions).all();
  const vapid = {
    subject: 'mailto:push@agent-lab.local',
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };
  const msg = {
    data: JSON.stringify({ title: 'New fire item', url: '/radar/items/xxx' }),
    options: { ttl: 3600, urgency: 'normal' as const, topic: 'radar' },
  };
  await Promise.allSettled(subs.map(async (s) => {
    const payload = await buildPushPayload(msg, s, vapid);
    const res = await fetch(s.endpoint, payload);
    if (res.status === 404 || res.status === 410) {
      await db.delete(subscriptions).where(eq(subscriptions.id, s.id));
    }
  }));
  return Response.json({ ok: true });
}
```

### VAPID key 管理
- **生成**：一次性，`generateVapidKeys()`（库自带）
- **存储**：`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` 放 CF Pages env（`wrangler secret put`）
- **前端**：`NEXT_PUBLIC_VAPID_PUBLIC_KEY` 传给 `pushManager.subscribe({ applicationServerKey })`
- **轮换**：仅在私钥泄露时做，轮换 = broadcast 让 SW 重新订阅

### 已知限制
- **Payload ≤ 2744 bytes 明文**（FCM bridge 后 base64 ~ 4KB 上限）→ 只塞 `{itemId, title, snippet<=120, url}`
- **Subscription 过期**：endpoint 返回 404/410 即永久失效，立即删 D1
- **Android 覆盖全面**（Chrome/Firefox/Samsung/Brave），库按 endpoint 自适配
- **iOS Safari 需 iOS 16.4+ + 添加到主屏 → 本期不做**

### 可观测性集成
- `push_send_total{browser, status_class}` counter → SigNoz
- `push_send_latency_ms` histogram
- `push_subscription_active` gauge（D1 count）
- `push_subscription_expired_rate`（410/404 rate）→ 异常告警

### 风险
- **R8.1 (低)**：VAPID 私钥管理 — CF Pages secret + wrangler 流程已成熟
- **R8.2 (中)**：403 / 413 / 429 不同错误码需分类处理（骨架已示范 404/410 清理）

---

## ADR-9 · Provider 稳定引用原则（跨库共性）

### 决策
**所有 React Context Provider 的 props 必须使用模块级稳定引用或 `useMemo(() => ..., [])`**。包括但不限于：
- `<CopilotKit>` 的 `headers` / `properties` / `agents__unsafe_dev_only`
- `<QueryClientProvider>` 的 `client`
- `<ViewportProvider>` 等自建 Provider

### 动机
issue #32 的直接教训（`RadarWorkspace.tsx` 历史）：destructure 默认 `= {}` 每 render 产生新 ref → effect 重跑 → 订阅覆盖。

### 实施约定
- `components/providers/` 集中放所有 Provider，并在文件顶部定义 `EMPTY_OBJ = Object.freeze({})`
- ESLint 自定义规则（可选）：`<CopilotKit>` 的 props 必须是 identifier 或带 deps=[] 的 useMemo
- PR review checklist 加一项

### 风险
- **R9.1 (低)**：自建规则不强制时依赖人工 review。建议先加 ESLint 警告级别规则观察

---

## 总体风险矩阵（合并）

| # | 风险 | 来源 ADR | 等级 | 缓解 |
|---|---|---|---|---|
| R-A | CopilotKit v2 API 4 个月 breaking 风险 | ADR-1 | 高 | PoC 先行 + v1 兜底预案 |
| R-B | trace_id 自动透传未证实 | ADR-1 | 中 | PoC 必测，手动注入 traceparent |
| R-C | SW / TanStack mutation queue 双队列 | ADR-2, ADR-7 | 中 | 约定 TanStack 权威，SW 只回推 online 信号 |
| R-D | Vaul + Serwist 关键库社区体量偏小 | ADR-4, ADR-7 | 中 | 备选库（react-modal-sheet）+ API 冻结 + 自 patch 路径 |
| R-E | iOS Safari 平台限制（Background Sync 无、Web Push 门槛高） | ADR-2, ADR-8 | 高 | 本期 Android 优先，iOS 下期 |
| R-F | Container Query iOS 15 用户体验紧凑 | ADR-6 | 低 | @supports 降级可接受 |
| R-G | Provider prop 引用漂移（#32 类） | ADR-9 | 中 | 跨库共性原则 + review checklist |

---

## 本期决策未覆盖的议题

以下在本次调研范围外，待后续补：

1. **颜色真值 / 字体栈 / Icon 具体选型** — 见 [`04-design-tokens.md`](./04-design-tokens.md)，需设计决策
2. **Error Boundary 粒度清单** — 需按 View 盘点
3. **前端 RUM metric schema 细化** — 与 `docs/22` ADR 序列对齐
4. **Lighthouse CI 预算文件** — Step 7 前写
5. **插图 / 空态 / 骨架设计资产** — 设计侧产出
6. **原生壳（Capacitor + APNs）** — 下期（Apple 账号阻塞）

---

## 迁移路线图调整

根据本 ADR，[`06-migration-roadmap.md`](./06-migration-roadmap.md) 需要新增 **Step 0 · 数据层迁移**（在原 Step 1 之前）：

```
Step 0 · TanStack Query 迁移（新增）
  ├─ QueryClient + Provider
  ├─ 4 个 hook 改写
  ├─ persistQueryClient + idb-keyval
  └─ Pending slice 改 useMutation offlineFirst
    （~1.5 天）
     ↓
Step 1 · Shell 抽象（原方案）
     ↓
...（Step 2-9 不变）
```

ADR-1 的 CopilotKit PoC 作为 **Step 3 前置**（独立 demo 项目，不在主代码里做）。

---

## 决策权威性

- 本 ADR 集合是 **2026-04-21 技术选型的单一事实源**
- 任何后续违反本 ADR 的代码决策（选其他库、混合数据层等）必须**在 ADR 文档里追加新条目**说明，并 deprecate 原条目
- 不得在 PR 里悄悄替换 ADR 决策

---

## 附录：8 项调研的证据源汇总

详见每个 ADR 的证据链节。原始调研输出归档在会话记录（8 个 agent 并行执行，各自独立联网）。

