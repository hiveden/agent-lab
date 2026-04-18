# 25 - TODO 统一索引

> **定位**：所有待办事项的**索引**（不重复内容，指向权威来源）。
> **规则**：新 TODO 先加到对应来源文档（21 / 22 / 23），再追加到本文索引。
> **最后更新**：2026-04-18

---

## 🔴 P0 — 阻塞当前目标

**来源：[`23-ARCHITECTURE-BACKLOG.md`](./23-ARCHITECTURE-BACKLOG.md)**

| # | 条目 | 估 | 依赖 |
|---|---|---|---|
| 23 #1 | **Python Agent 部署方案**（Fly.io / Railway / 自建）| 4h-1d | 无 |
| 23 #2 | **CI/CD pipeline**（GitHub Actions: lint + test + E2E + 自动部署）| 1-2d | #1 |
| 23 #3 | **用户 / 认证系统**（替代 DEFAULT_USER_ID 硬编码）| 2-3d | 无 |

---

## 🟡 P1 — 企业级必备

**来源：[`23-ARCHITECTURE-BACKLOG.md`](./23-ARCHITECTURE-BACKLOG.md)** + 项目管理

| # | 条目 | 估 |
|---|---|---|
| **📋 PM** | **把 25-TODO / 26-KNOWN-BUGS 迁 GitHub Issues**（labels: p0-p3 + bug/feat/debt + observability/agent/infra; milestones; project board; 留 stub md 指向）。当前 4 份交叉引用索引已到复杂度临界点。详见 2026-04-18 讨论。| 30 min |
| 23 #4 | **LLM Gateway**（LiteLLM / Helicone，统一 provider + cost 追踪）| 1d |
| 23 #5 | **Secret management**（Vault / Infisical / Doppler，替代 .env 裸奔）| 半天 + 每 secret 迁 |
| 23 #6 | **Rate limiting + CORS 收紧** | 半天 |
| 23 #7 | **dev/staging/prod 环境分离** | 1d + 持续 |

---

## 🟢 P2 — LLM 能力 + 观测深化

### LLM 专属（[`23`](./23-ARCHITECTURE-BACKLOG.md)）

| # | 条目 | 估 |
|---|---|---|
| 23 #8 | **Eval pipeline**（Langfuse LLM-as-judge + datasets + experiments）| 2-3d |
| 23 #9 | **Prompt version control**（Langfuse Prompt Management 迁 prompt）| 1d |

### 观测深化（[`22-OBSERVABILITY-ENTERPRISE.md`](./22-OBSERVABILITY-ENTERPRISE.md) Phase 5-7）

| Phase | 条目 | 估 | 当前状态 |
|---|---|---|---|
| **22 Phase 5 #2** | **对照实验验证 START 根因**（临时绕过 DeferredLLM 跑一次，确认是否真是 ag-ui-langgraph bug）| 15 min | ⏳ 暂缓，下一个可做的最小单元 |
| 22 Phase 6 | 给 ag-ui-langgraph / CopilotKit 上游提 issue/PR | 数小时 | 依赖 5#2 结论（若是上游 bug 才提）|
| 22 Phase 7 | Pyroscope profiling + SLO 告警 | 1-2d | 触发条件：P95 > 5s 或多用户 |

---

## 🔵 P3 — 可选 / 机会性

### 大块（[`23`](./23-ARCHITECTURE-BACKLOG.md)）

| # | 条目 | 触发条件 |
|---|---|---|
| 23 #10 | RAG 基础设施（pgvector / Qdrant / Cloudflare Vectorize）| Radar 要向量搜索 |

### 小块（[`23` 末尾清单](./23-ARCHITECTURE-BACKLOG.md#其他小块没独立条目按需做)）

Feature flags / LLM response caching / IaC / Audit log / Content moderation / Chaos testing / Product analytics / Visual regression / Runbook / ADR 独立目录

### 22 文档散落注记

| 位置 | 条目 |
|---|---|
| 22 ADR-010 | `tracer.py` 未独立产 OTel span（OpenLLMetry 已覆盖，等 GenAI semconv 标准化再做）|
| 22 ADR-010 | `gen_ai_attrs.py` 占位实现（未来扩展 AG-UI event → OpenInference / GenAI semconv）|
| 22 Phase 4 #4 | **Langfuse 与 SigNoz 共享 ClickHouse**（未实现，标未来探索；schema 冲突风险高）|
| 22 Phase 3 Step 3 | **CopilotKit poll 导致 chip trace_id 不准**（chip 抓最近 fetch 的 trace_id 而非 send chat 的；优化方向：按 ag-ui agent.subscribe 监听 send 事件后才采）|
| 22 风险表 #17 | opentelemetry-python 1.26.0 auto-instrument 回归（监控升级时回归）|
| 22 风险表 #3, #8, etc. | 所有 28 条已知风险见 22 文档第 5 章 |

---

## 技术债（[`21-TECH-DEBT.md`](./21-TECH-DEBT.md)）

**领域**：会话持久化（Phase 3 A1 后）。

| 级别 | 条目 |
|---|---|
| ✅ 已解决 | Phase 3 A1 commit a2bbc6b（死代码 / 双模式 / trace 构建统一）+ 批量清理 aa0878c（message_count / type 拆分 / showDevConsole / chat_messages 注释）|
| P0 | #2 文档代码不一致（已修 header, 各章节正文对齐完成）|
| P1 | 无当前 open |
| P2 | #7 / #8 已解决 |
| P3 | #10 E2E 4 个历史失败（非阻塞）/ #11 106 个 TS implicitly-any（非阻塞）/ #12 zustand 5.x 兼容性（运行正常）|

**架构注释（非技术债）**：两条会话路线（Inbox vs Agent）是并存设计，产品决策后再考虑合并。

---

## 推荐启动路径

**最短路径到"可 demo 的企业级"（~5-7d）**（来自 23）：

```
1. 23 #3 用户/认证         (2-3d)  ← 解锁多用户
2. 23 #1 Python Agent 部署  (4h-1d) ← 脱离本地
3. 23 #2 CI/CD             (1-2d)  ← 自动化
4. 23 #4 LLM Gateway        (1d)   ← 成本可见
5. 23 #8 Eval pipeline      (2-3d) ← 模型质量可度量
```

**最短路径到"observability 闭环"（半天）**：

```
1. 22 Phase 5 #2 对照实验   (15 min) ← 验证 START 根因
2. 22 Phase 6 上游 issue   (数小时) ← 若 5#2 证明是上游 bug
```

---

## 维护约定

- **新增 TODO**：先加到 21/22/23 对应文档，再更新本索引
- **完成时**：源文档加 ✅ + commit hash，本索引直接删该条目（不保留已完成的，减少阅读负担）
- **每 milestone 回顾**：调整优先级

---

## 文档地图

| 文档 | 职责 |
|---|---|
| `25-TODO.md`（本文）| 所有 TODO 索引 |
| `26-KNOWN-BUGS.md` | 已知 bug 索引（与本文互补：待做 vs 已有问题） |
| `21-TECH-DEBT.md` | 技术债（现有代码） |
| `22-OBSERVABILITY-ENTERPRISE.md` | 可观测性架构 + ADR + Phase + 风险 |
| `23-ARCHITECTURE-BACKLOG.md` | 架构缺口（未做的新功能） |
| `24-OBSERVABILITY-PLAYBOOK.md` | 排查手册 |
| `02-ARCHITECTURE.md` | 项目整体架构 |
| `03-TECH-STACK.md` | 技术栈登记 |
