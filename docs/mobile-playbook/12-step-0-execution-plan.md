# 12 · Step 0 · 数据层迁移执行计划（SWR → TanStack Query v5）

> **前置**：[`10-tech-selection-adr.md`](./10-tech-selection-adr.md) ADR-2 已决定迁移方向。
> **输入**：现有 4 个 SWR hook + 1 个 utils + Zustand pending slice。
> **输出**：TanStack Query v5 + IndexedDB persist cache，为后续 Step 9 offline/PWA 打基础。
> **不做**：Mutation queue / Background Sync 集成（留给 Step 9）。本 Step 只做**等价替换 + persist cache**。

---

## 0 · 范围边界（重要）

### 做什么
- ✅ SWR → TanStack Query v5 等价替换（query 层）
- ✅ `persistQueryClient` + idb-keyval 持久化 cache
- ✅ `networkMode: 'offlineFirst'` 全局配置（为 Step 9 offline 打底）
- ✅ RunsView 的 `mutate()` → `queryClient.invalidateQueries`
- ✅ 移除 `swr` 依赖

### 不做
- ❌ **Pending queue 改 useMutation**（原 Zustand slice `applyPending` 保留 fetch + Promise.allSettled，成功后 invalidate）
- ❌ **Mutation queue 持久化 / Background Sync**（Step 9 PWA/Offline）
- ❌ **SSE chat 纳入 cache**（chat 走 CopilotKit AG-UI，不经 TanStack）
- ❌ **DevTools 引入**（本 Step 不碰，Step 7 性能优化时一起）

**核心原则**：**等价功能，零行为回归**。验收以"用户侧行为与改前无差别"为准，cache/persist 是幕后加强。

---

## 1 · 现状盘点（实读代码，2026-04-21）

### 1.1 SWR 使用点（4 处 hook + 1 处组件内 mutate）

| 文件 | 功能 | API 形状 |
|---|---|---|
| `lib/hooks/use-items.ts` | `/api/items?agent_id=radar&limit=400&status=...` | `{ items, isLoading, error, mutate }` |
| `lib/hooks/use-runs.ts` | `/api/runs?agent_id=radar&phase=&limit=` | `{ runs, isLoading, error, mutate }` |
| `lib/hooks/use-session-list.ts` | `/api/chat/sessions?agent_id=...` | `{ sessions, isLoading, error, reload }` |
| `lib/hooks/use-agent-session.ts` | `/api/chat/sessions?thread_id=...` | `{ session, isLoading, error, mutate }` |
| `lib/hooks/swr-utils.ts` | `swrFetcher` + `SWR_DEFAULT_OPTIONS` | `{ revalidateOnFocus: false, dedupingInterval: 2000 }` |
| `components/production/RunsView.tsx:117,136` | `mutate()` 触发重取 | 2 处调用 |

### 1.2 Pending 逻辑（Zustand slice，不是 hook）

`lib/stores/radar-store.ts:223-269` 的 `applyPending`：
- `Promise.allSettled` 并发 PATCH 所有 pending items
- 成功后本地 `items` 过滤 + `pending: {}` 重置 + toast

**迁移决定**：保留此 slice 逻辑不动，仅在 success 后调用 `queryClient.invalidateQueries(['items', ...])` 替代现有的本地 `items` 过滤逻辑（或并行做）。避免大改。

---

## 2 · 目标架构

```
┌──────────────────────────────────────────────────────────────┐
│  Layer 4: Components / Views                                 │
│    useItems() / useRuns() / useSessionList() / ...          │
├──────────────────────────────────────────────────────────────┤
│  Layer 3: Query hooks（薄包装）                                │
│    useQuery({queryKey, queryFn, ...DEFAULT_OPTIONS})         │
├──────────────────────────────────────────────────────────────┤
│  Layer 2: QueryClient + persister + networkMode              │
│    lib/providers/query-provider.tsx (Client Boundary)        │
├──────────────────────────────────────────────────────────────┤
│  Layer 1: idb-keyval stores + persister adapter              │
│    lib/offline/{stores,query-persister}.ts                   │
└──────────────────────────────────────────────────────────────┘
```

---

## 3 · 任务分解（4 阶段，Phase 2 可并行）

### Phase 0.1 · 基础设施（主线串行，~30 min）

**由我在主线直接做，不开 subagent**（依赖链太紧，subagent 来回效率低）。

| # | 文件 | 动作 |
|---|---|---|
| 1 | `apps/web/package.json` | `pnpm add @tanstack/react-query@^5 @tanstack/query-async-storage-persister@^5 idb-keyval@^6` |
| 2 | `apps/web/src/lib/offline/stores.ts` **新建** | 集中 idb-keyval `createStore` 常量（`QUERY_STORE` / `PENDING_STORE` / `ITEMS_STORE`） |
| 3 | `apps/web/src/lib/offline/query-persister.ts` **新建** | idb-keyval → AsyncStorage `{getItem,setItem,removeItem}` adapter（5 行） |
| 4 | `apps/web/src/lib/providers/query-provider.tsx` **新建** | `'use client'` + `QueryClient` + `QueryClientProvider` + `persistQueryClient` 挂载 |
| 5 | `apps/web/src/app/layout.tsx` | 在 `<body>` 内 `<OtelClientInit />` 下一行加 `<QueryProvider>` 包裹 `{children}` |

**QueryClient 默认配置**：
```ts
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2000,              // ≈ SWR dedupingInterval
      refetchOnWindowFocus: false,  // ≈ SWR revalidateOnFocus: false
      networkMode: 'offlineFirst',  // 为 Step 9 打底
      retry: 1,
    },
    mutations: {
      networkMode: 'offlineFirst',
      retry: 1,
    },
  },
});
```

**Phase 0.1 验收**：
- `pnpm build` 过
- 跑 `pnpm dev` 打开 UI，首页能加载（此时 hooks 还没迁，但 Provider 不应该破坏现有 SWR 行为）

---

### Phase 0.2 · 三路 Hook 迁移（并行 subagent，每路 ~20 min）

三个 Lane 相互无依赖（文件不重叠），开 3 个 subagent 并行做。

#### Lane A · items Hook + 消费者

**修改文件**：
- `apps/web/src/lib/hooks/use-items.ts`（重写）
- `apps/web/src/app/agents/radar/RadarWorkspace.tsx`（`mutateItems` 已解构但未使用，核对）

**对外契约保持**：`{ items, isLoading, error, mutate }`——调用方代码不变。

**迁移模板**：
```ts
import { useQuery } from '@tanstack/react-query';
import { itemsQueryKey } from './query-keys'; // 可选统一 key 生成

export function useItems(activeView: ViewType) {
  const isItemView = activeView === 'inbox' || activeView === 'watching' || activeView === 'archive';
  const status = viewToStatus(activeView);

  const query = useQuery({
    queryKey: ['items', 'radar', { status }],
    queryFn: () => fetchJSON<{ items: ItemWithState[] }>(
      `/api/items?agent_id=radar&limit=400&status=${status}`
    ),
    enabled: isItemView,
  });

  return {
    items: query.data?.items ?? [],
    isLoading: query.isLoading,
    error: query.error,
    mutate: () => query.refetch(),  // 等价 SWR mutate 无参形式
  };
}
```

**Lane A 验收**：
- Inbox / Watching / Archive 三个 view 都能加载 items
- 切换 view 时列表更新正确
- 错误态（网络断开）显示错误

#### Lane B · runs Hook + RunsView

**修改文件**：
- `apps/web/src/lib/hooks/use-runs.ts`（重写）
- `apps/web/src/app/agents/radar/components/production/RunsView.tsx`（2 处 `mutate()`）

**RunsView 里 `mutate()` 改 `queryClient.invalidateQueries`** 或 `query.refetch()`（后者更简单，hook 返回的 mutate 继续保留等价语义）。

**Lane B 验收**：
- RunsView 列表加载
- "刷新" 按钮能触发重取
- 触发一次 `ingest` 后列表自动更新

#### Lane C · session 两个 Hook

**修改文件**：
- `apps/web/src/lib/hooks/use-session-list.ts`（重写）
- `apps/web/src/lib/hooks/use-agent-session.ts`（重写）
- （无消费点改动，契约保持）

**Lane C 验收**：
- AgentView 会话列表加载
- 打开一个 session，ConfigSnapshot / ResultsPane 正常渲染

---

### Phase 0.3 · Pending + Invalidate（主线，~30 min）

**范围**：`lib/stores/radar-store.ts` 的 `applyPending` 成功后触发 `queryClient.invalidateQueries(['items'])`。

**挑战**：Zustand slice 在 hook 之外，不能直接 `useQueryClient()`。两种办法：

**方案 A（推荐）**：导出一个**模块级 QueryClient 单例**（在 `query-provider.tsx` 里创建并 `export`），slice 直接 `import` 使用。
```ts
// query-provider.tsx
export const queryClient = new QueryClient({...});
// ...Provider 用同一个实例
```
```ts
// radar-store.ts applyPending 末尾
import { queryClient } from '@/lib/providers/query-provider';
queryClient.invalidateQueries({ queryKey: ['items'] });
```

**方案 B**：`applyPending` 接一个回调参数，调用点（`RadarWorkspace` 或 `PendingChangesBanner`）传入 `queryClient.invalidateQueries`。

选 A，更少改动。

**保留现有逻辑**：本地 `items` 过滤 + `pending: {}` 重置 + toast 全部保留（双保险，invalidate 补一层 refetch）。

**Phase 0.3 验收**：
- Mark 3 条 + Apply → Items 从列表中移除（本地过滤生效）
- Apply 后 `useItems` 后续自动重取（invalidate 生效，可通过 DevTools Network 看新请求）

---

### Phase 0.4 · 验证 + 清理（主线，~30 min）

#### 验收 E2E

- [ ] `pnpm build` 通过
- [ ] `pnpm test` 通过（Vitest 现有测试）
- [ ] `pnpm dev` 启动，手动冒烟：
  - [ ] Inbox 加载 items
  - [ ] 切换到 Watching、Archive
  - [ ] Mark 3 条 + Apply
  - [ ] Runs view 加载 runs，"刷新"按钮
  - [ ] Agent view 加载 session 列表 + 打开一个
  - [ ] 飞行模式刷新页面（或 Chrome Network Offline）→ Inbox 仍显示上次缓存数据 ← **persist 新能力**
- [ ] `bash scripts/run-e2e.sh` 现有 Playwright tests 通过

#### 清理

- [ ] `grep -r "from 'swr'" apps/web/src/` 无命中
- [ ] `grep -r "useSWR" apps/web/src/` 无命中
- [ ] `pnpm remove swr`（根目录 / apps/web）
- [ ] 删除 `apps/web/src/lib/hooks/swr-utils.ts`（或改名 `fetch-utils.ts` 复用 `swrFetcher` 为 `fetchJSON`）

#### Bundle size 记录

```bash
cd apps/web && pnpm build 2>&1 | tee build-after-step0.log
```
对比 Step 0 前后 First Load JS。预期：+8-12KB gzip（TanStack Query v5 核心）。

---

## 4 · 并行开发的 Subagent 清单

### Subagent Lane A · items

```
你是 Lane A 开发者。Step 0 Phase 2 数据层迁移 SWR → TanStack Query v5。

范围（不得越界）：
- 改写 apps/web/src/lib/hooks/use-items.ts
- 若 apps/web/src/app/agents/radar/RadarWorkspace.tsx 有 `mutateItems` 的使用，确保契约兼容

依赖（已就绪）：
- QueryClient 已在 @/lib/providers/query-provider.tsx 导出
- queryClient 单例已挂 QueryClientProvider 到根 layout
- fetchJSON 在 @/lib/hooks/swr-utils.ts 里叫 swrFetcher，可直接用或改名引入

对外契约保持：
- export function useItems(activeView) -> { items, isLoading, error, mutate }
- mutate() 等价 query.refetch()（无参形式）

验收：
- pnpm build 过
- Inbox/Watching/Archive 三视图能加载
- pnpm test 过

产出：简短完成报告（≤300 字）+ 修改的文件清单。
```

### Subagent Lane B · runs

```
你是 Lane B 开发者。改写：
- apps/web/src/lib/hooks/use-runs.ts
- apps/web/src/app/agents/radar/components/production/RunsView.tsx（2 处 mutate 调用点，行号 117/136）

范围、依赖、契约同 Lane A（参见 12-step-0-execution-plan.md）。

验收：
- pnpm build 过
- RunsView 能刷新 / 触发 ingest 后自动更新
```

### Subagent Lane C · sessions

```
你是 Lane C 开发者。改写两个 hook：
- apps/web/src/lib/hooks/use-session-list.ts（导出 reload，等价 mutate）
- apps/web/src/lib/hooks/use-agent-session.ts（保留 mutate）

范围、依赖、契约同 Lane A。

验收：
- pnpm build 过
- Agent view session 列表 + 打开一个 session 正常
```

---

## 5 · 执行顺序与时间预算

```
T+0:00   Phase 0.1 基础设施（主线我做）
T+0:30   └─ Provider + persister + stores 就绪
T+0:30   Phase 0.2 三 Lane 并行（subagent-A, B, C 同时启动）
T+1:00   └─ 最慢 Lane 完成
T+1:00   Phase 0.3 Pending + invalidate（主线）
T+1:30   └─ applyPending 接入 invalidate
T+1:30   Phase 0.4 验证 + 清理（主线）
T+2:00   ✅ Step 0 完成
```

**总时长**：~2 小时（含 buffer）。比原估 1.5 天（=12h）快一个数量级，因为实际改动比想象小。

---

## 6 · 回滚策略

每个 Phase 独立 commit，失败能单独回：

- **Phase 0.1 失败**：`git revert HEAD` 回到 SWR 原状
- **Phase 0.2 某 Lane 失败**：该 Lane 的 hook 不合入，其他 Lane 继续（QueryClient 已挂不影响 SWR）
- **Phase 0.3 失败**：applyPending 保留原逻辑，不接 invalidate
- **Phase 0.4 清理失败**：暂不移除 swr 依赖（双栈共存可运行）

Hook 契约保持稳定是回滚的关键——消费方不感知底层切换。

---

## 7 · 风险登记

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R1 | persistQueryClient 对 SSR hydration 冲突 | 中 | Provider 用 `'use client'`，只在 CSR 初始化 persister |
| R2 | queryKey 设计不统一 | 低 | 三 Lane 各自定义，本 Step 不求统一；Step 5 Primitives 抽取时重构 |
| R3 | 模块级 queryClient 单例 vs SSR 多实例 | 中 | 用 `typeof window !== 'undefined'` guard，SSR 时用 new per request |
| R4 | idb-keyval SSR 报错 `indexeddb is not defined` | 中 | persister 在 Provider 内用 `typeof window !== 'undefined'` 包裹，只 CSR 启用 |
| R5 | 现有 Playwright E2E 依赖 SWR 行为 | 低 | 跑 `bash scripts/run-e2e.sh` 验证，若失败定位具体 spec |

---

## 8 · 完成标准

- [x] Phase 0.1 基础设施就绪
- [ ] Phase 0.2 三 Lane 全部完成
- [ ] Phase 0.3 applyPending 接 invalidate
- [ ] Phase 0.4 验证通过 + swr 依赖移除
- [ ] bundle size 记录
- [ ] 两个 commit：`feat(data)`：Phase 0.1-0.3；`chore(data)`：0.4 清理
- [ ] 更新 `06-migration-roadmap.md` Step 0 → ✅

---

## 9 · 开工前决策点（需用户确认）

- **D1**：上述方案 A（模块级 queryClient 单例）OK？
- **D2**：`swrFetcher` 改名 `fetchJSON` 留着，还是直接删文件？（留着 = 少改 import；删 = 更彻底）
- **D3**：Bundle 对比是否必做？（不做也行，TanStack gzip ~13KB 已知）

确认后即开始 Phase 0.1。
