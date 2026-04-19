# 31 - 采集模块需求设计

> **定位**：Radar 一期采集模块（Ingest）的需求契约 + 闭环验证。
> **范围**：模块边界内的功能 / 非功能需求，不含部署。

---

## 1. 模块职责

按用户配置的 `sources`，定时或手动触发，拉外部内容入 `raw_items` 表，供过滤模块消费。

```
┌──────────┐  cron/manual   ┌─────────────┐  HTTP fetch   ┌──────────┐
│ Sources  │ ─────trigger──▶│ Ingest core │ ───────────▶  │ External │
│  config  │                │ pipelines/  │ ◀────────── │ HN/RSS/.. │
└──────────┘                │ ingest.py   │               └──────────┘
                            └──────┬──────┘
                                   │ POST /api/raw-items/batch
                                   ▼
                            ┌─────────────┐
                            │  raw_items  │  status=pending
                            │  runs       │  type=ingest
                            └─────────────┘
```

---

## 2. 输入 / 输出契约

### 输入
- `sources` 表记录：`id / source_type / config(JSON) / enabled / attention_weight`
- 触发：Cloudflare Cron → `POST /api/cron/radar/ingest` / 用户点 "同步" 按钮 → 同
- 透传到 Python：`POST /agent/radar/ingest` (Bearer `RADAR_WRITE_TOKEN`)，body `{sources: [...]}` 或空（空则 Python 拉 platform）

### 输出
- `raw_items` 新增：`external_id` 去重，`status=pending`，`source_id` / `raw_payload` 完整
- `runs` 新增：`type=ingest`，`status=done/failed`，`result_summary={fetched, inserted, skipped}`
- SSE stream：每 source 一个 `span` 事件（running / done / failed + count + sample_titles）

---

## 3. 功能需求 (FR)

| # | 需求 | 验收 |
|---|---|---|
| FR-1 | 支持 4 种 source type：`hacker-news` / `http` / `rss` / `grok` | 4 个 collector 模块存在 + 可实例化 |
| FR-2 | Source CRUD（增 / 删 / 改 / 启用-禁用） | `SourcesView` UI 操作生效 |
| FR-3 | Source 测试采集（添加前预览 config 正确性） | `POST /api/sources/test` 返 `{ok, count, items[]}` |
| FR-4 | 手动触发全量 ingest（不等 cron） | `RunsView` "同步" 按钮触发后 Runs 表新增 |
| FR-5 | Cron 定时触发 | `POST /api/cron/radar/ingest` 200 + 执行流程（本地手动模拟 OK；prod cron 需部署） |
| FR-6 | 单 source 失败不影响其他 | 故意配一个错的 RSS + 一个好的 HN，好的仍成功 |
| FR-7 | external_id 去重（幂等） | 同 source 连跑两次，第二次 `skipped=N inserted=0` |
| FR-8 | 结果可见 | Runs 表 + FunnelView 每 source 显示 fetched/inserted |

---

## 4. 非功能需求 (NFR)

| # | 需求 | 验收 |
|---|---|---|
| NFR-1 | 单 source ingest < 30s (typical) | typical HN top 30 在 10s 内 |
| NFR-2 | 可观测：OTel span per source collect | Langfuse / SigNoz 能看到 span |
| NFR-3 | 错误：单 source 故障 log + continue | 见 FR-6 |
| NFR-4 | 幂等：重复调用不副作用 | 见 FR-7 |
| NFR-5 | 安全：Bearer `RADAR_WRITE_TOKEN` | 无 auth 调 `/agent/radar/ingest` → 401（已 ✅） |

---

## 5. 当前实现 vs 需求：Gap 分析（2026-04-19）

| FR/NFR | 状态 | 备注 |
|---|---|---|
| FR-1 | ✅ | `collectors/` 4 个模块 |
| FR-2 | ✅ | `SourcesView` |
| FR-3 | ✅ | `/api/sources/test` + UI 结果区 |
| FR-4 | ✅ | `RunsView:111` `drainSSE('/api/cron/radar/ingest')` |
| FR-5 | ⚠️ | 代码就绪，**prod cron 未实跑**（部署后验，非本模块阻塞） |
| FR-6 | ✅ | **今日修复** (fad8a13：rss_collector 错误包装 + pipeline `except Exception` 兜底) |
| FR-7 | ✅ | `collectors/base.py` + D1 `raw_items(source_id, external_id)` unique 约束 |
| FR-8 | ✅ | Runs + FunnelView |
| NFR-1 | ✅ | HN 实测 5-10s |
| NFR-2 | ✅ | ADR-002c trace 三端贯穿 |
| NFR-3 | ✅ | 见 FR-6 |
| NFR-4 | ✅ | 见 FR-7 |
| NFR-5 | ✅ | `_check_auth` |

---

## 6. 功能闭环验证步骤

本地 end-to-end：

1. 起 Python agent + BFF + LiteLLM（不必须，ingest 不调 LLM）
2. 浏览器打开 `http://127.0.0.1:8788/agents/radar`
3. 进 Sources → 添加一个 HN source → 点 "测试" → 预览返回 count > 0（FR-3）
4. 保存启用
5. 故意再加一个错的 RSS source（feed_url = `http://nonexistent.local/rss`）并启用
6. 进 Runs → 点 "同步" → 观察：
   - HN source span: done, fetched N, inserted N
   - 错的 RSS span: failed, 不阻塞 HN（FR-6）
7. 查 raw_items 表：有 N 条 pending（FR-8）
8. 再次点 "同步" → HN span 显示 skipped=N, inserted=0（FR-7 去重）

**PASS 标准**：所有 8 步都通过。

---

## 7. 关联

- 实现：`agents/radar/src/radar/pipelines/ingest.py`、`collectors/*.py`
- BFF 接入：`apps/web/src/app/api/cron/radar/ingest/route.ts`、`/api/sources/test/route.ts`
- Schema：`sources` / `raw_items` / `runs` in `apps/web/src/lib/db/schema.ts`
- 测试：`agents/radar/tests/test_collectors_hn.py`
- 上游文档：`docs/06-SOURCE-COLLECTION.md` / `docs/02-ARCHITECTURE.md`
