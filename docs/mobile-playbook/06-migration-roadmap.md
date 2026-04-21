# 06 · 迁移路线图

> 从当前架构到 [`01-architecture-rfc.md`](./01-architecture-rfc.md) 目标架构的 9 步迁移。
> 每步独立 PR，main 随时可发布。

---

## 本期 vs 下期边界

| 里程碑 | 内容 | 依赖 |
|---|---|---|
| **M3 Mobile First**（本期） | Step 1-9 | 无阻塞 |
| **M4 Mobile Native**（下期） | Phase 4 Capacitor + APNs | ⏸ 等 Apple 开发者账号 |

---

## Step 0 · 数据层迁移 SWR → TanStack Query（✅ 2026-04-21 完成）

**目标**：按 [`10-tech-selection-adr.md`](./10-tech-selection-adr.md) ADR-2 迁移数据层，为 Mobile offline / persist / mutation queue 打基础。

### 变更

- 新增 `QueryClient` + `QueryClientProvider` 到根 layout
- 改写 `use-items.ts` / `use-runs.ts` / `use-session-list.ts` / `use-agent-session.ts`（SWR → TanStack Query v5）
- `RunsView.tsx` 的 `mutate()` 改 `queryClient.invalidateQueries`
- 加 `lib/offline/query-persister.ts`（idb-keyval adapter，5 行）
- 加 `persistQueryClient` 配置，`networkMode: 'offlineFirst'`
- Pending slice 改用 `useMutation` + `onMutate/onError/onSettled`

### 验收 E2E

- [ ] 所有列表页数据渲染与 Step 0 前一致（无功能回归）
- [ ] TanStack DevTools 可见 cache 条目
- [ ] 飞行模式刷新页面，Inbox 仍显示上次缓存数据
- [ ] 离线时 mark 一条 item，网络恢复后自动提交（看 `resumePausedMutations` 日志）

### 风险

- SSR hydration 配 `HydrationBoundary`
- SW 还没上，offline 只有 persister 层。Step 9 后才完整（SW 接 `onlineManager`）

### 估时：~1.5 天 · 实际 ~2 h（Phase 0.1/0.2 并行 + 0.3/0.4 主线）

### 实施产出（2026-04-21）

- 4 hooks 迁移：use-items / use-runs / use-session-list / use-agent-session
- 基础设施：`lib/providers/query-provider.tsx` + `lib/offline/{stores,query-persister}.ts`
- **Provider 挂在业务子路由 `app/agents/radar/layout.tsx`**（关注点分离，根 layout 保持纯净）
- `applyPending` 成功后 `queryClient.invalidateQueries(['items'])`
- swr 依赖移除，swr-utils.ts 改名 fetch-utils.ts（`swrFetcher` 保留为向后兼容别名）
- Bundle 增量：`/agents/radar` 837 KB（+4 KB vs 迁移前）

### 途中修复的 bug

- Phase 0.1 pnpm add 误装到仓库根而非 apps/web（package.json 未记录）— 被 `pnpm remove swr` 触发 GC 暴露，已在 apps/web 正确重装

---

## Step 1 · 断点 + Shell 抽象（✅ 2026-04-21 完成）

**目标**：建立三档 viewport 机制和三个空 Shell，内容暂不改。

### 变更

- 新增 `apps/web/src/lib/hooks/useViewport.ts`（替代 `useIsMobile`）
- 新增 `apps/web/src/app/agents/radar/shells/{Mobile,Tablet,Desktop}Shell.tsx`（空壳）
- `RadarWorkspace.tsx` 改为按 `useViewport()` 选 Shell，原内容保留
- Layout 层加 `ViewportProvider` + UA Hint 预判

### 验收 E2E

```ts
// apps/web/e2e/mobile-shell.spec.ts
test('compact shell at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/agents/radar');
  await expect(page.locator('[data-shell="compact"]')).toBeVisible();
});
test('medium shell at 768px', ...);
test('expanded shell at 1440px', ...);
test('rotate does not lose URL state', ...);
```

### 风险

- UA Hint `Sec-CH-UA-Mobile` 在 Safari 支持有限 → 降级成客户端判断，CLS 略大但可接受

---

## Step 2 · 路由化 item detail（✅ 2026-04-21 完成）

**目标**：item 选中从 zustand 迁到 URL。

### 变更

- 新增 `app/agents/radar/items/[id]/page.tsx`
- Mobile 选中 → `router.push`；Desktop 选中也更新 URL 但 layout 内嵌渲染
- `selectedId` 从 store 移除，改读 `useParams`

### 验收 E2E

- [ ] Mobile 点击 item，URL 变化，浏览器后退返回 inbox
- [ ] Desktop URL 同步，刷新页面能恢复选中
- [ ] 分享 URL `/items/abc` 到新窗口直达 detail

---

## Step 3 · Chat 通路统一 AG-UI

**目标**：废除 `/api/chat`，Mobile chat 接入 AG-UI。

### 前置

- ✅ **PoC 验证完成**（2026-04-21）：`poc/copilotkit-v2-useagent/` VERDICT PASS 6/7 + 2 跳过，详见 [`11-poc-copilotkit-v2.md`](./11-poc-copilotkit-v2.md)
- 读 `09-COPILOTKIT-AGUI-INTEGRATION.md` 确认 headless 使用姿势

### 变更

- 新 Layer 2 hook：`apps/web/src/lib/hooks/useChatSession.ts`
  - 基于 `@copilotkit/react-core` headless API
  - 返回 `{ messages, sendMessage, isStreaming, toolCalls }`
- `MobileChatView` / `ChatView` 都消费此 hook，不再自己 fetch
- 删除 `/api/chat` 路由及 handler

### 验收

- [ ] Mobile 发一条消息，Langfuse 看到 trace，带正确 trace_id
- [ ] trace 在 SigNoz 从前端 OTel → BFF → Python 完整贯穿
- [ ] tool call 卡片在 Mobile 正确渲染（与桌面一致样式）
- [ ] `grep -r "/api/chat" apps/` 无残留引用

### 风险

- AG-UI headless 使用案例少 → PoC 必须先做
- 流式 SSE 在 iOS Safari 某些版本可能有 buffering → 真机验证

---

## Step 4 · Pending queue 统一

**目标**：Mobile swipe 不再直接 fetch，走 pending。

### 变更

- 删除 `RadarWorkspace.tsx:330-351` 里 Mobile 的直接 `fetch PATCH`
- Mobile swipe → `markPending`
- 新 primitive：`PendingChangesSheet.tsx`（底部滑上，包含 list + Apply/Discard）
- Mobile Shell 渲染 `PendingChangesSheet`，Desktop Shell 渲染 `PendingChangesBanner`（现有）

### 验收

- [ ] Mobile swipe 3 条，Sheet 显示 "Apply 3 changes"
- [ ] 点 Apply 走与桌面相同的 `applyPending` 路径
- [ ] Undo toast 在 5s 内可撤销
- [ ] 离线 swipe 3 条，网络恢复后 Sheet 仍在，可提交

---

## Step 5 · Primitives 抽取

**目标**：删除 Mobile* 重复组件，建立响应式 Primitives。

### 变更

- 新 `apps/web/src/components/primitives/`
  - `ItemCard.tsx`（替代 `MobileItemsList` 的 `SwipeableCard` + `ItemsList` 的卡片）
  - `MessageBubble.tsx`
  - `FilterChip.tsx`
  - `Sheet.tsx`
  - `SearchCommand.tsx`（替代 `CommandPalette`，Mobile 全屏 + Desktop modal）
- 删除 `MobileItemsList.tsx` / `MobileChatView.tsx`
- 所有 View 组件用新 Primitives 重组

### 验收

- [ ] Mobile 和 Desktop 视觉一致性比对（截图 diff）
- [ ] bundle 大小（`next build --analyze`）比 Step 4 小（重复代码删除）
- [ ] `grep -r "MobileItemsList\|MobileChatView" apps/` 无引用

---

## Step 6 · Tablet 档位

**目标**：medium viewport 真正可用，iPad 竖屏不挤桌面。

### 前置

- 用户确认 iPad 使用场景（决策 O1）

### 变更

- `TabletShell.tsx` 填充实现
- Sources / Runs / Agent 三个 View 适配 medium（加 container query）
- NavRail 窄版 + Slide Panel 实现

### 验收（真机 iPad）

- [ ] iPad 竖屏进入 medium Shell
- [ ] 分屏缩小到 <768 自动退回 compact
- [ ] Magic Keyboard 连接时 J/K 导航生效

---

## Step 7 · 性能优化

**目标**：命中性能预算。

### 变更

- `@tanstack/react-virtual` 引入 Inbox 列表
- 骨架屏替换空壳占位
- 路由级 `dynamic()` 拆 Shell bundle
- Lighthouse CI 纳入 GitHub Actions

### 验收

- [ ] Lighthouse mobile 分数 ≥ 90
- [ ] bundle 预算：Mobile first paint ≤ 120KB gzip
- [ ] Inbox 1000 条滚动 FPS ≥ 55（真机 iPhone SE / Android 低端机）
- [ ] FCP / LCP / CLS 达到 SLO

---

## Step 8 · PWA-lite

**目标**：可添加到主屏。

### 变更

- `public/manifest.json`
- icon 套件（设计资产配合）
- iOS-specific meta tags

详见 [`05-pwa-strategy.md`](./05-pwa-strategy.md) Phase 1。

### 验收

- [ ] iOS Safari / Android Chrome 都能添加到主屏
- [ ] Lighthouse PWA 审计 ≥ 90

---

## Step 9 · Offline + Android Push

**目标**：SW 上线，Inbox 离线可读，Android 可推送。

### 变更

- `next-pwa` 集成 SW
- IndexedDB pending queue
- Background Sync flush 逻辑
- VAPID key 配置 + 订阅 UI（可选）

详见 [`05-pwa-strategy.md`](./05-pwa-strategy.md) Phase 2 + 3a。

### 验收

- [ ] 飞行模式 Inbox 可读
- [ ] 离线 swipe 恢复后自动提交
- [ ] Android 真机推送测试（可选）

---

## 并行 / 串行 依赖关系

```
Step 0 (Data Layer) ──→ Step 1 (Shell) ──┬─→ Step 2 (URL)    ──→ Step 6 (Tablet)
                                         ├─→ Step 3 (AG-UI)  ──→ Step 5 (Primitives) ──→ Step 7 (Perf)
                                         └─→ Step 4 (Pending)┘

Step 3 前置 ── AG-UI useAgent PoC（独立 demo 项目，不占主代码）
  
Step 7 ──→ Step 8 (PWA-lite) ──→ Step 9 (Offline + Push)
```

**关键路径**：0 → 1 → 3 → 5 → 7 → 8 → 9。Step 2/4/6 可并行穿插。

---

## 里程碑汇总

| Milestone | 包含 Step | 阻塞 |
|---|---|---|
| **M3.1 架构修复** | 1-5 | 无（P0 必做） |
| **M3.2 Tablet 支持** | 6 | 依赖用户反馈 O1 |
| **M3.3 性能** | 7 | 无 |
| **M3.4 PWA 离线** | 8-9 | 无 |
| **M4 Native**（下期） | Phase 4 | ⏸ Apple 开发者账号 |

---

## Risk Tracker

| # | Risk | 发生概率 | 影响 | 缓解 |
|---|---|---|---|---|
| R1 | AG-UI headless hook 踩坑 | 中 | Step 3 延迟 | PoC 先行 |
| R2 | iOS Safari SW 行为异常 | 中 | Step 9 延迟 | 只在 production 启用 |
| R3 | Container Query iOS 15 不支持 | 低 | Step 2 / 5 降级 | @supports 降级 |
| R4 | 虚拟滚动与 AnimatePresence 冲突 | 中 | Step 7 需重设计 | POC 或换 CSS transition |
| R5 | UA Hint 在 Safari 不稳 | 中 | CLS 略差 | 客户端判断降级 |

---

## 开始与完成标记约定

- 每个 Step 对应一个 GitHub Milestone
- 每个验收条目对应一个 issue
- PR 合入时勾选条目
- Step 全部条目勾完 → Milestone close → README 对应行标记 ✅
