# 32 - Inbox 模块需求设计（Desktop）

> **定位**：Radar 一期 Inbox 消费模块需求契约 + 闭环验证（Desktop 路径）。
> **范围**：Desktop 桌面端交互路径。Mobile 单独开发（见 ROADMAP 后续阶段）。
> **上游依赖**：过滤模块输出 `items` 表记录（grade=fire/bolt/bulb）。
> **下游数据**：`user_states` 表累积行为信号 → 认知之镜模块聚合（7 非一期）。

---

## 1. 模块职责

消费过滤模块推到的 items，让用户**在最低打扰下完成浏览 + 筛选 + 标注 + 讨论**，同时**静默采集行为信号**回流给认知之镜。

```
┌──────────┐        ┌──────────────────────────────────┐
│  items   │───────▶│         Inbox 模块 (Desktop)     │
│ (上游产出) │        │                                  │
└──────────┘        │  ┌─────────────┐ ┌─────────────┐ │
                    │  │  卡片列表    │ │ 详情 + Chat │ │
                    │  │ (筛选/tab)  │ │             │ │
                    │  └──────┬──────┘ └──────┬──────┘ │
                    │         │               │         │
                    └─────────┼───────────────┼─────────┘
                              │ status 标注    │ dwell 采集
                              ▼               ▼
                       ┌──────────────────────────┐
                       │     user_states 表       │
                       │ (status + view_duration) │
                       └──────────────────────────┘
```

---

## 2. 输入 / 输出契约

### 输入
- `items` 表记录：`id / grade / title / summary / why / url / tags / agent_id / source`
- 读 API：`GET /api/items?agent_id=radar&status=...`

### 输出
- `user_states` 表：`(user_id, item_id) → status + view_duration_ms + updated_at`
- 写 API：`PATCH /api/items/:id/state` `{status?, dwell_ms?}`

### 状态机
```
unread → read | watching | dismissed | archived
                ↓    ↓         ↓        ↓
            (持续 dwell 累加 view_duration_ms)
```

---

## 3. 功能需求（FR）

| # | 需求 | 验收 |
|---|---|---|
| FR-1 | 卡片列表按时间倒序展示 | Inbox 打开默认按 `created_at desc` |
| FR-2 | 按 grade 筛选（fire / bolt / bulb / all） | chips 可切，结果正确 |
| FR-3 | **按 source 筛选**（单选 / 多选） | 选某 source 只显示该源 items |
| FR-4 | 三态 tab：inbox / watching / archive | 对应 status != read&!dismissed / watching / dismissed or read |
| FR-5 | 卡片详情：title + summary + why + grade + source + url | 右侧 pane 展开详情 |
| FR-6 | **Desktop 标注**：watching / dismissed 按钮 | 点击写入 `user_states.status` |
| FR-7 | **Dwell time 采集**（Desktop） | 用户在详情/chat 页停留时长累加 `view_duration_ms` |
| FR-8 | **Inbox → Chat 跳转**：选某 item 讨论 | 同页内联 chat（非跳出） |
| FR-9 | **批量操作**：多选 + 批量标记（watching / dismiss / archive） | Cmd/Shift 多选 + 批量提交 |
| FR-10 | 空态：无 items / 无 fire / 无 watching | 友好提示，引导 "去 sources 配订阅 / 去 runs 手动同步" |
| FR-11 | 错误态：API 失败 | toast + 重试按钮 |

---

## 4. 非功能需求（NFR）

| # | 需求 | 验收 |
|---|---|---|
| NFR-1 | 初次加载 < 1s（仅 D1 查询，无 LLM）| — |
| NFR-2 | 状态写入乐观更新 + 后台批量提交 | `PendingChangesBanner` 机制已有 |
| NFR-3 | Dwell 采集不卡 UI | `useDwellTracker` hook（passive） |
| NFR-4 | 零打断（产品哲学）：无强制弹窗 | 代码无 Modal/Dialog.required 等 |
| NFR-5 | 错误不阻塞整体 | 单条 PATCH 失败 toast，其他继续 |

---

## 5. 当前实现 vs 需求：Gap 分析

| FR/NFR | 状态 | 证据 |
|---|---|---|
| FR-1 | ✅ | `InboxView` / `ItemsList` |
| FR-2 | ✅ | chips fire/bolt/bulb/all |
| FR-3 | ❌ **缺** | `ItemsList` 无 source 过滤 UI/逻辑 |
| FR-4 | ✅ | `InboxView:13` `CategoryTab: inbox/watching/archive` |
| FR-5 | ✅ | `InboxView` 右侧 pane |
| FR-6 | ✅ | `InboxView:253-272` watching/dismissed 按钮 + `markPending` |
| FR-7 | ❌ **缺**（#28） | `useDwellTracker` 仅 `MobileChatView` 挂载 |
| FR-8 | ✅ 内联 | `InboxView:82` selectedItem → ChatView |
| FR-9 | ⚠️ **部分** | `markPending` + `PendingChangesBanner` 机制在, 但多选 UI 存在否待验 |
| FR-10 | ⚠️ **待验** | 空态文案是否覆盖 3 种子场景 |
| FR-11 | ⚠️ **待验** | 错误态实现情况 |
| NFR-1 | ✅ | 仅 D1 查询 |
| NFR-2 | ✅ | PendingChangesBanner 机制 |
| NFR-3 | ✅ | hook 设计 passive |
| NFR-4 | ✅ | 代码 grep 无 Modal required |
| NFR-5 | ⚠️ 待验 | — |

---

## 6. Gap 优先级

### 🔴 核心功能缺
- **FR-3** 按 source 筛选：items 多了只能按 grade 过滤，不够细

### 🟡 产品认知之镜需要
- **FR-7** Desktop dwell（独立 issue #28）：当前 desktop 消费完全不入镜，与产品哲学"行为即数据"冲突

### ⚠️ 待验证（可能是"其实有只是我没看见"）
- **FR-9** 批量 UI 可见性（ctrl/shift 多选 / 全部清空）
- **FR-10** 空态 3 种场景
- **FR-11** 错误态 toast + 重试

---

## 7. 今天能做的最小集（控制 1-1.5h）

1. **FR-3 按 source 筛选**（30-45 min）
   - `ItemsList` 加 source chips 或 dropdown
   - 客户端过滤（items 已带 source 字段）

2. **FR-9 / FR-10 / FR-11 快速验证**（20 min）
   - 读代码确认实现情况，记录 gap
   - 小 bug 当场修

3. **FR-7 Desktop dwell 留 #28 明天做**（超出今天范围，且涉及 dwell 语义设计：哪层算 dwell）

---

## 8. 功能闭环验证步骤

1. 起 Python agent + BFF（LiteLLM 非必需）
2. 打开 `/agents/radar`，Inbox 视图
3. **FR-2**：点 fire/bolt/bulb chip，列表过滤正确
4. **FR-3**（今天修后）：点 source 过滤，只看某源的 items
5. **FR-4**：切 watching tab，看只显示 status=watching 的
6. **FR-5**：点卡片，右侧显示详情
7. **FR-6**：点"watching"按钮 → PendingChangesBanner 提示 → 提交 → D1 `user_states` 有记录
8. **FR-8**：点卡片 → 内联 chat 出现 → 发一条消息 → agent 能接到 item 上下文
9. **FR-10**：空态验证：删光 items / 切到 watching 看"暂无关注" / archive

**PASS 标准**：所有可验证步骤都通过，FR-7（dwell）承认延后。

---

## 9. 关联

- 实现：`apps/web/src/app/agents/radar/components/consumption/InboxView.tsx`、`ItemsList.tsx`、`ChatView.tsx`
- Schema：`items` / `user_states` in `apps/web/src/lib/db/schema.ts`
- API：`GET /api/items` / `PATCH /api/items/:id/state`
- 上游：[`31-INGEST-DESIGN.md`](./31-INGEST-DESIGN.md)、过滤模块 `chains/recommend.py` 产出 items
- 下游（非一期）：`AttentionView` / 周报（认知之镜模块）
- 相关 issue：#28 Desktop dwell
