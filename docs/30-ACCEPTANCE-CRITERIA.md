# 30 - Acceptance Criteria (Phase 1 MVP DoD)

> **定位**：Phase 1 MVP "交付合格"的显式标准。每个交付物 = 实现 + 测试 + 验收指标三位一体。
> **来源**：`docs/01-PHILOSOPHY.md` 产品哲学 + `ROADMAP.md` Phase 1 + 本 session 盘点。
> **使用**：部署前按本文逐项过，✅ 全绿才发布；任何 ❌ / ⚠️ 都要有明确决策（修 / 延后 / 砍）。
> **最后更新**：2026-04-19

---

## 0. 交付合格的定义

**不是"代码能跑"**，是：
1. 产品哲学 4 条 UX 原则可验证达成
2. ROADMAP Phase 1 "锁定决策" 全部落地
3. 每个核心用户故事端到端可演示
4. 回归测试 checklist 全绿

---

## 1. 产品目标级 DoD

### 1.1 认知之镜（核心交付）

| 子项 | 实现 | 测试 | 验收标准 |
|---|---|---|---|
| Sources 按"理想权重"配置（ideal self）| ✅ `SourcesView.attention_weight` slider | ⚠️ 无 E2E | 新建 source 时可设权重、权重总和可视化 |
| 行为信号采集 — swipe left/right | ✅ `MobileItemsList` `onSwipeAction` → PATCH status | ✅ mobile E2E | 左滑=dismissed 右滑=watching，状态写入 D1 |
| 行为信号采集 — dwell time | ⚠️ **仅 mobile chat**（`MobileChatView` + `useDwellTracker`）；**desktop 缺** | ⚠️ 无 E2E | desktop 看卡片详情 / chat 时应累加 `view_duration_ms` |
| 行为信号采集 — chat rounds | ✅ `chat_messages` 表天然计数 | ✅ history-recovery | 按 item / session 可算对话深度 |
| 注意力画像可视化（actual vs expected 柱状图）| ✅ `AttentionView` + `/api/attention/snapshot` + recharts | ❌ **无 E2E** | 每源 expected vs actual 对比 + deviation 标签（+N% 偏高 / -N% 偏低） |
| **每周 GAP 报告**（终极交付物）| ❌ **未实现** | ❌ | 周六/周日自动生成一份"本周注意力 GAP 摘要"，可读 / 可存档 / 可推送 |

**✅ 达成指标**：所有子项 ≥ ⚠️；GAP 报告必须 ✅（产品哲学明确说这是"终极交付物"）

### 1.2 终端分工（mobile 轻消费 / desktop 指挥中心）

| 子项 | 实现 | 测试 | 验收 |
|---|---|---|---|
| Mobile：滑动过滤 + 全屏 chat + Tab 导航 | ✅ | ✅ mobile×6 | 所有 mobile.spec.ts 通过 |
| Desktop：NavRail + resizable panels + 完整 chat trace | ✅ | ✅ production / consumption | 通过 consumption 4 步 + production 6 步 |
| 自适应切换（ViewportContext）| ✅ | ⚠️ 无显式测试 | 375/768/1440 三断点视觉正确 |

### 1.3 零打断

| 子项 | 实现 | 验收 |
|---|---|---|
| 无强制评分弹窗 | ✅（sonner toast 只做反馈）| 代码搜索 `Modal\|Dialog.*required\|评分` 0 处 |
| 错误提示非阻塞 | ✅ toast | ✅ |
| 行为采集后台静默 | ✅ `useDwellTracker` 无 UI | ✅ |

### 1.4 行为即数据（显性评分 0 依赖）

| 子项 | 实现 | 验收 |
|---|---|---|
| 无 "点赞 / 收藏 / 评分 / 打标签" UI | ✅ | grep `rating\|like\|star` 不命中 |
| 所有信号来自自然交互 | ✅ | `SIGNAL_WEIGHTS` 只有 consumed / watching / chatRound / dismissed |

---

## 2. 技术交付级 DoD（ROADMAP Phase 1 "锁定决策"）

### 2.1 BFF（Next.js + D1 + Drizzle）

| 条目 | 状态 | 验收 |
|---|---|---|
| monorepo `agent-lab` | ✅ | pnpm workspaces + uv workspace |
| Next.js App Router + edge runtime | ✅ | `pnpm dev:web` :8788 |
| Cloudflare Pages 工具链 | ⚠️ 配置就绪**未部署** | 运行一次 `pnpm deploy:web` 拿到 prod URL（#1）|
| D1 + Drizzle schema | ✅ | migrations 0001-0004 齐 |
| 关键 API（items/sources/runs/chat/settings/attention）| ✅ | curl 核心 endpoint 返 200 |
| API 认证 — Bearer `RADAR_WRITE_TOKEN` | ✅ | 写入型 endpoint 无 auth 返 401 |
| CORS 收紧 + prod guard | ✅（今天） | 生产 `DEPLOY_ENV=production` + localhost origins 启动报错 |

### 2.2 Python Agent（FastAPI + LangGraph + LangChain）

| 条目 | 状态 | 验收 |
|---|---|---|
| HN / HTTP / RSS / Grok collectors | ✅ | `POST /ingest` 全 4 类走通 |
| Evaluate pipeline（LLM 评判推广）| ✅ | `radar-push evaluate` 跑通 |
| LangGraph ReAct agent + 4 tools | ✅ | `POST /agent/chat` SSE 流 + tool call |
| `get_llm(task)` 工厂（含缓存 + 热更）| ✅（今天 ADR-011）| `PUT /api/settings` 触发 `llm_cache_invalidated`，<50ms |
| LiteLLM Gateway（多 provider）| ✅（今天 #4）| `docker/litellm` 栈 + Python 经 :4000 拿到响应 |
| AG-UI 事件不双发 | ✅（今天 ADR-011）| E2E TEXT_START=1/dup=0 |
| 部署到云（Fly.io / Railway / ...）| ❌ **未做** | 有 prod URL 可访问（#1）|

### 2.3 前端

| 条目 | 状态 | 验收 |
|---|---|---|
| Radar Inbox（卡片 + 筛选 chips）| ✅ | consumption Step 1 pass |
| Chat UI（CopilotKit v2 + AG-UI + tool call 渲染）| ✅ | consumption Step 2/3 pass |
| 历史会话恢复 | ✅ | history-session-recovery pass |
| Settings UI（LLM 切换）| ⚠️ provider 下拉未对齐 LiteLLM model_name（#26）| 用户能在 UI 完整切换 provider/model 且立即生效 |
| Runs 视图（数据血缘）| ✅ | production Step 5 pass |
| Attention Mirror 视图 | ✅ | ❌ **无 E2E**（需补）|
| Sources 管理（weight 编辑）| ✅ | ❌ **无 E2E**（需补）|
| Walkthrough（sources→trigger→runs→chat）| ✅ | walkthrough 1 pass |

### 2.4 Cron + 调度

| 条目 | 状态 | 验收 |
|---|---|---|
| `POST /api/cron/radar/ingest` endpoint | ✅ | BFF 手动触发通 |
| `POST /api/cron/radar/evaluate` endpoint | ✅ | 手动触发通 |
| Cloudflare Pages Cron Trigger（定时执行）| ⚠️ 配置就绪未跑真实 cron | prod 部署后跑 24h 看 Runs 表增长（#1 后）|
| 每周 GAP 报告 cron | ❌ **未实现** | 每周跑一次，结果存 `weekly_reports` 表或推通知 |

### 2.5 Observability（今天完成）

| 条目 | 状态 |
|---|---|
| trace_id 三端贯穿 | ✅ ADR-002c |
| Langfuse（LLM trace + cost） | ✅ 自托管 + cloud 双栈 |
| SigNoz（通用 trace / log / metric）| ✅ |
| GlitchTip（错误聚合）| ✅ |
| OTel Collector 拆分双管道 | ✅ |
| AGUIEventDedup 补丁删除后无双发 | ✅ ADR-011 |

---

## 3. Gap 清单（按产品优先级）

### 🔴 P0 产品核心未达成（阻塞 MVP 合格）

| Gap | 影响 | 建议工单 |
|---|---|---|
| **每周 GAP 报告未实现** | 产品哲学"终极交付物"缺失 | 新开 issue：Attention 周报生成 + 存档 + （可选）推送 |
| **Desktop dwell_ms 未采集** | 行为信号只有 mobile，desktop 用户注意力不入镜 | 新开 issue：desktop SessionDetail / CardDetail 接 useDwellTracker |

### 🟡 P1 测试覆盖缺失（能过发布但隐患）

| Gap | 工单 |
|---|---|
| AttentionView 无 E2E | 新开：E2E Attention 画像断言 |
| SourcesView weight 编辑无 E2E | 新开：E2E Sources 权重增删改 |
| Settings UI 无完整 E2E（切 provider + save + reload 链路）| 新开 |
| 视觉回归（375/768/1440 断点）无显式 test | 新开 |

### 🟢 P2 部署前置（技术 gap）

| Gap | 工单 |
|---|---|
| Cloudflare Pages 首次部署 | #1 |
| Python Agent 云托管部署 | #1 |
| Cron Trigger prod 实跑验证 | #1 |
| CI/CD 自动化 | #2 |

### 🔵 P3 已验收未尽项

| Gap | 工单 |
|---|---|
| BFF Settings UI 对齐 LiteLLM model_name | #26 |
| 用户认证（多用户）| #3（产品哲学明确 Phase 1 "写死 default_user"，不阻塞 MVP）|

---

## 4. 回归测试 Checklist（发布前必过）

### 自动化
- [ ] `pnpm test`（BFF vitest）全绿
- [ ] `uv run pytest agents/radar/tests/`（Python）全绿
- [ ] `bash scripts/run-e2e.sh`（完整 Playwright）25/25 全绿
- [ ] pytest + vitest 总覆盖 > 70%（当前未测，需加 coverage 报告）

### 手动冒烟
- [ ] Settings UI 切换 provider + save → Python log 打出 `llm_cache_invalidated`
- [ ] Settings UI Test Connection 按钮通过
- [ ] 手动触发 ingest（`POST /api/cron/radar/ingest`）→ Runs 表新增 + raw_items 入库
- [ ] 手动触发 evaluate → items 表新增 fire/bolt 记录
- [ ] Chat 发一条消息 → SSE 流正常 + 无双发 + trace_id 三端一致
- [ ] Chat 触发 tool call（web_search / github_stats）→ 工具执行且渲染
- [ ] 左右滑卡片 → item.status 正确写入（mobile）
- [ ] 停留在 chat 30s+ → `view_duration_ms` 累加（mobile）
- [ ] AttentionView 柱状图显示 expected vs actual，deviation 标签正确
- [ ] Runs 视图点击 run → 详情页显示配置快照 + 结果摘要
- [ ] 历史会话点击 → 消息恢复 + trace 显示

### Observability
- [ ] 发 chat → Langfuse 可见 trace，GENERATION 数量 = LLM 调用次数 ×2 视角（非双发）
- [ ] 发 chat → SigNoz 可见 BFF + Python span
- [ ] 触发错误 → GlitchTip 收到 issue
- [ ] chip trace_id 点 Langfuse 链接打开正确 trace

### 安全
- [ ] `ALLOWED_ORIGINS` 仅 dev origins 时，生产启动报错
- [ ] `RADAR_WRITE_TOKEN` 默认值时，生产启动报错
- [ ] `/api/items/batch` 无 Bearer → 401
- [ ] `/internal/reload-llm` 无 Bearer → 401

---

## 5. 交付合格判定（Scoreboard）

按 section 打分，∑ 就是 MVP 健康度：

| 维度 | 权重 | 当前分 | 目标 |
|---|---|---|---|
| 产品目标（§1）| 40% | **75%**（认知之镜核心在，周报 + desktop dwell 缺 10%，E2E 缺 15%）| ≥ 95% |
| 技术交付（§2）| 30% | **85%**（部署未做 -10%，Settings UI -5%）| ≥ 90% |
| 回归测试（§4）| 20% | **60%**（自动化绿，手动冒烟没过完整清单 + 覆盖率无数据）| ≥ 90% |
| 安全基线（§4 末）| 10% | **70%**（CORS / token guard 今天加，其他未验证）| ≥ 90% |

**加权总分**：75%×0.4 + 85%×0.3 + 60%×0.2 + 70%×0.1 = **74.5%**

**合格阈值**：**≥ 85%** 可以部署。

**离合格还差**：
1. 补周报生成（产品分 +15% → §1 到 90%）
2. 补 desktop dwell + 4 个 E2E（§1 到 100%，§4 自动化到 95%）
3. 跑完手动冒烟清单（§4 到 90%）
4. 做首次部署（§2 到 95%）

**预期修补后分数**：94%，可以部署。

---

## 6. 文档地图

| 文档 | 职责 |
|---|---|
| `30-ACCEPTANCE-CRITERIA.md`（本文）| Phase 1 MVP 合格标准 |
| `01-PHILOSOPHY.md` | 产品哲学（认知之镜 / 零打断 / 行为即数据）|
| `ROADMAP.md` | Phase 1/2/3 交付计划 |
| `02-ARCHITECTURE.md` | 整体架构 |
| `22-OBSERVABILITY-ENTERPRISE.md` | 可观测性决策（含 ADR-011 DeferredLLM）|
| `23-ARCHITECTURE-BACKLOG.md` | 架构缺口（部署 / 认证 / Gateway ...）|
| GitHub Issues | 所有待办 |
