# 信息源配置与数据采集

## 模块划分

信息采集和内容消费是两个独立模块，通过 D1 数据表解耦。

```
┌─────────────────────────────────────┐
│  数据生产（本文档）                    │
│                                     │
│  Sources → Ingest → Evaluate → Items │
│                                     │
│  关注：配置、采集、评判、数据质量       │
└──────────────┬──────────────────────┘
               │ items 表
┌──────────────▼──────────────────────┐
│  内容消费（Inbox）                    │
│                                     │
│  Items → 浏览 → Chat → 状态流转      │
│                                     │
│  关注：展示、交互、认知镜像            │
└─────────────────────────────────────┘
```

本文档只覆盖**数据生产**模块。

---

## 功能设计

### 数据流

```
配置阶段：
  用户创建 Source（type + config + weight）
  → test-collect 验证配置可用
  → Source 持久化到 D1

采集阶段（Ingest）：
  触发 → CP 读 enabled sources
  → POST Python /ingest
  → Collector 按 source_type 采集（走代理）
  → POST /api/raw-items/batch → D1 raw_items (status=pending)
  → 创建 Run 记录（phase=ingest, stats）

评判阶段（Evaluate）：
  触发 → POST Python /evaluate
  → 读 pending raw_items → LLM 评分分级
  → POST /api/items/batch → D1 items
  → raw_items status → promoted / rejected
  → 创建 Run 记录（phase=evaluate, stats）
```

### Source 类型

| 类型 | Collector | 配置项 | 代理 |
|------|-----------|--------|------|
| hacker-news | HNCollector | `{ limit }` | 需要 |
| http | HttpCollector | `{ url, method, items_path, mapping, limit }` | 需要 |
| rss | RssCollector | `{ feed_url, limit }` | 需要 |
| grok | GrokCollector | `{ accounts, batch_size, api_url, model }` | 需要 |

代理通过 Settings 配置中心统一管理（`HTTPS_PROXY` / `HTTP_PROXY`）。

### 触发方式

1. **Topbar Trigger 按钮** — ingest + evaluate SSE，实时 trace
2. **Command Palette (Cmd+K)** — "Trigger Radar collection"
3. **Runs 视图 Trigger 按钮** — ingest + evaluate
4. **Cron（待实现）** — Schedule UI 已有，后端待对接

---

## User Stories

### US-1: 添加信息源

**作为**用户，**我想**添加一个新的信息源，**以便**系统能从该源采集内容。

**验收标准：**
- 进入 Sources 视图，点击 Add Source
- 选择 source type，填写 name、config、weight
- 点击 Test 验证配置可用（返回 count > 0）
- 保存后 Sources 列表显示新 source

### US-2: 手动触发采集

**作为**用户，**我想**手动触发一次采集，**以便**立即获取最新内容。

**验收标准：**
- 点击 Trigger 按钮
- Ingest：从所有启用 sources 采集 raw_items
- Evaluate：LLM 评判，生成 items
- Runs 视图记录本次执行，显示统计（fetched / inserted / promoted / rejected）
- items 表新增数据（供 Inbox 消费，但不在本模块验证 Inbox 展示）

### US-3: 管理信息源

**作为**用户，**我想**编辑、启用/禁用、删除已有信息源，**以便**调整采集范围。

**验收标准：**
- 编辑：修改 config/weight 后保存生效
- 禁用：disabled source 不参与下次采集
- 删除：source 及关联 raw_items 级联删除
- 权重条形图实时反映各 source 占比

### US-4: 查看采集历史

**作为**用户，**我想**查看每次采集的执行记录，**以便**了解采集状态和数据质量。

**验收标准：**
- Runs 视图显示所有 ingest/evaluate 记录
- 每条 run：phase、status、stats、duration
- 点击查看详情：per-source breakdown、trace、错误信息

---

## E2E 测试用例

所有测试用例的边界：验证数据正确写入 D1，不涉及 Inbox 展示。

### TC-1: 从零配置到首次采集（核心路径）

**前置条件：** 干净数据库（清空 sources、raw_items、items、runs）

```
Step 1: 验证空状态
  - GET /api/sources → sources.length === 0
  - 打开 Sources 视图 → 显示空状态
  - 截图: sources-empty.png

Step 2: 创建数据源
  - POST /api/sources
    { agent_id: "radar", source_type: "hacker-news",
      name: "HN Top", config: { limit: 5 },
      attention_weight: 1.0, enabled: true }
  - 验证: 201, source.id 存在
  - GET /api/sources → sources.length === 1
  - 截图: sources-created.png

Step 3: 验证采集配置
  - POST /api/sources/test
    { source_type: "hacker-news", config: { limit: 3 } }
  - 验证: ok === true, count >= 1

Step 4: 触发 ingest
  - POST /api/cron/radar/ingest
  - 等待完成
  - GET /api/raw-items?agent_id=radar
    → raw_items.length >= 1, 全部 status=pending
  - GET /api/runs?agent_id=radar&phase=ingest
    → runs.length === 1, status === "done"
    → stats.fetched >= 1, stats.inserted >= 1

Step 5: 触发 evaluate
  - POST /api/cron/radar/evaluate
  - 等待完成
  - GET /api/raw-items?agent_id=radar&status=pending → length === 0
  - GET /api/raw-items?agent_id=radar&status=promoted → length >= 1
  - GET /api/items?agent_id=radar → items.length >= 1
  - GET /api/runs?agent_id=radar&phase=evaluate
    → runs.length === 1, status === "done"
    → stats.promoted >= 1

Step 6: 验证 Runs 执行结果（UI）
  - 打开 Runs 视图
  - 验证: 2 条 run（1 ingest + 1 evaluate）
  - ingest run: stats 显示 fetched/inserted 数值
  - evaluate run: stats 显示 promoted/rejected 数值
  - 截图: runs-result.png

Step 7: 数据完整性校验
  - sources: 1
  - raw_items: >= 1（无 pending，全部 promoted 或 rejected）
  - items: >= 1（每条有 grade、summary、why）
  - runs: 2
```

### TC-2: 多类型 Source 采集

**前置条件：** 干净数据库

```
Step 1: 创建 3 个 source
  - hacker-news: { limit: 3 }
  - http: { url: GitHub API, mapping: {...}, limit: 3 }
  - rss: { feed_url: AI News RSS, limit: 3 }
  - GET /api/sources → length === 3

Step 2: 逐个 test-collect
  - HN: ok === true, count >= 1
  - HTTP: ok === true, count >= 1
  - RSS: ok === true, count >= 1

Step 3: 错误类型处理
  - POST /api/sources/test { source_type: "nonexistent" }
  - 验证: HTTP 400

Step 4: 触发 ingest + evaluate
  - raw_items 来自 3 个不同 source_id
  - items 包含多个 source
  - Runs 的 ingest run 包含 3 个 source 的 per-source breakdown
```

### TC-3: Source 管理操作

**前置条件：** 1 个启用的 source，已有采集数据

```
Step 1: 禁用 source
  - PATCH /api/sources/{id} { enabled: false }
  - 触发 ingest
  - 验证: 无新 raw_items（无启用 source）
  - Run stats: fetched === 0

Step 2: 重新启用
  - PATCH /api/sources/{id} { enabled: true }
  - 触发 ingest
  - 验证: raw_items 增加

Step 3: 修改配置
  - PATCH /api/sources/{id} { config: { limit: 2 } }
  - 触发 ingest
  - 验证: 新 raw_items 数量 <= 2

Step 4: 删除 source
  - DELETE /api/sources/{id}
  - GET /api/sources → length === 0
  - 验证: 关联 raw_items 级联删除
```

### TC-4: Sources + Runs UI 视觉验证

**前置条件：** TC-1 执行后有数据

```
Step 1: Sources 视图
  - 打开 Sources tab
  - 验证: source 卡片、权重条形图、启用状态
  - 视觉审计 + 截图

Step 2: 手动触发（UI Trigger 按钮）
  - 点击 Topbar Trigger
  - 验证: 按钮变为 "Running..."
  - 等待完成
  - 验证: Toast 显示采集统计（N new · M duplicate）

Step 3: Runs 视图
  - 打开 Runs tab
  - 验证: run 列表、stats 数值、状态 badge
  - 点击 run → 详情展开（per-source breakdown、trace）
  - 视觉审计 + 截图
```

---

## 与现有 E2E 的关系

现有 `desktop.spec.ts` 部分覆盖：

| 现有测试 | 对应 TC | 覆盖情况 |
|---------|--------|---------|
| Step 2b (test-collect) | TC-2 Step 2-3 | 覆盖 |
| Step 3 (ingest) | TC-1 Step 4 | 部分（依赖 seed source，非从零创建）|
| Step 4 (evaluate) | TC-1 Step 5 | 部分 |
| Step 9 (management views) | TC-4 Step 1,3 | 视觉审计覆盖 |

**缺失：**
- TC-1 完整路径（清空 → 创建 source → 采集）
- TC-3 全部（source 禁用/启用/删除的行为验证）
- TC-4 Step 2（UI Trigger 按钮的交互验证）
