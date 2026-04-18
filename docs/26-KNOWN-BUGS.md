# 26 - 已知 Bug 索引

> **定位**：项目当前已知但未修复的 bug 集中索引（不重复内容，指向权威来源）。
> **与 21 区别**：21 是"代码债"（冗余 / 待清理），本文是"功能性问题"（事件重复 / UI 崩 / 警告等）。
> **与 25 区别**：25 是"要做的事"，本文是"已有的问题"。
> **最后更新**：2026-04-18

---

## 分类图例

- 🔴 **上游 bug** — 别人的代码，我们绕过或等修
- 🟡 **下游补丁中** — 我们已盖住但根因未严格验证，长期要消除补丁
- 🟢 **低优先级** — 非阻塞，有时间再修
- ❌ **未记录** — 文档里暂无权威来源，本次补上

---

## 🔴 上游 Bug（等上游修）

### Bug 1: CopilotKit Dev Console 显示 0 messages / 0 tool calls

- **表现**：Dev Console 计数为 0 但 trace 正常有 200+ events
- **根因**：CopilotKit `convertEventToMessage` 丢弃 `rawEvent` + `lc_run--<uuid>` 作 message_id 状态机错乱
- **状态**：绕过 — 用 SigNoz / Langfuse 看 trace，不依赖 Dev Console
- **上游追踪**：[CopilotKit #3039](https://github.com/CopilotKit/CopilotKit/issues/3039)（rawEvent 透传）+ [#3208](https://github.com/CopilotKit/CopilotKit/issues/3208)（INCOMPLETE_STREAM）
- **权威来源**：[`22` ADR-002a / ADR-002c](./22-OBSERVABILITY-ENTERPRISE.md)

### Bug 2: CopilotKit HITL 场景 `runId` 会被刷新

- **表现**：Human-in-the-loop 恢复时，`runId` 重新生成破坏 trace 连续性
- **影响**：当前无 HITL 场景，不阻塞；上 HITL 前必须复查
- **上游追踪**：[CopilotKit #3456](https://github.com/CopilotKit/CopilotKit/issues/3456)（PR #3458 review 中）
- **权威来源**：[`22` 风险表 #15](./22-OBSERVABILITY-ENTERPRISE.md)

### Bug 3: Next.js Edge middleware tracing 不完整

- **表现**：middleware 不产 OTel span / 与 page handler 分独立 trace
- **影响**：BFF 中关键追踪逻辑放 page handler 而非 middleware
- **上游追踪**：[Next.js #80445](https://github.com/vercel/next.js/issues/80445)
- **权威来源**：[`22` ADR-008 + 风险表 #4](./22-OBSERVABILITY-ENTERPRISE.md)

### Bug 4: FastAPI `StreamingResponse` 的 OTel span 提前关闭

- **表现**：`opentelemetry-instrumentation-fastapi` 对 ASGI streaming 的 span 在 generator 开始流之前就 close
- **影响**：SSE endpoint 的 span timing 失真
- **上游追踪**：[opentelemetry-python-contrib #831](https://github.com/open-telemetry/opentelemetry-python-contrib/issues/831) / [#3267](https://github.com/open-telemetry/opentelemetry-python-contrib/issues/3267) / [opentelemetry-python #4430](https://github.com/open-telemetry/opentelemetry-python/issues/4430)
- **当前做法**：接受不完美（Langfuse callback 层的 span 覆盖了实际 LLM timing，影响小）
- **权威来源**：[`22` ADR-009 + 风险表 #1](./22-OBSERVABILITY-ENTERPRISE.md)

---

## 🟡 下游补丁中（根因未严格验证）

### Bug 5: ag-ui-langgraph 重复 `TEXT_MESSAGE_START` / `TOOL_CALL_START` 事件

- **表现**：本地模型 (Ollama) streaming chunks 被 adapter 对同一 `event_id` 发射 ≥2 次 START 事件，下游 AG-UI 状态机拒 re-START
- **根因**：**未严格验证**。17 文档描述是观察猜测，可能实际是 **DeferredLLM + LangGraph astream_events 组合效应**（与 Bug 6 同源）
- **状态**：补丁盖住（`observability/repair.py`，env `REPAIR_AGUI_DEDUP=1` 默认开）
- **下一步**：对照实验（22 Phase 5 #2，15 min）→ 临时绕过 DeferredLLM 跑一次，若重复消失则**不是上游 bug**
- **权威来源**：[`17-AGUI-STREAMING-DEDUP.md`](./17-AGUI-STREAMING-DEDUP.md) + [`22` ADR-010](./22-OBSERVABILITY-ENTERPRISE.md) + [`25-TODO.md` 22 Phase 5 #2](./25-TODO.md)

### Bug 6: DeferredLLM + LangGraph 导致 `TEXT_MESSAGE_CONTENT` 连续重复

- **表现**：每个 token `delta` 被 emit 两次（同 `message_id` + 同 `delta`）
- **根因**：✅ **已确认** — `DeferredLLM` 是 `BaseChatModel` 子类包装器，LangGraph `astream_events` 捕获**所有** BaseChatModel 节点的 `on_chat_model_stream`，wrapper + inner 各触发一次 → AG-UI 事件双发
- **状态**：**这是设计组合效应不是真 bug**，补丁长期保留（`observability/repair.py` CONTENT 连续去重）
- **不提上游 issue**：我们自己代码决定，ag-ui-langgraph / LangGraph 都不欠我们修
- **权威来源**：[`17-AGUI-STREAMING-DEDUP.md`](./17-AGUI-STREAMING-DEDUP.md)（详细排查过程） + [`22` ADR-010](./22-OBSERVABILITY-ENTERPRISE.md)

### Bug 7: CopilotKit 频繁 poll `/api/agent/chat` 致 chip `trace_id` 不准

- **表现**：浏览器 chip 显示的是最近一次 fetch 的 trace_id（可能是 CopilotKit 的 status poll），不是真实 send chat 的
- **影响**：点 chip 跳 Langfuse 可能 "Trace not found"（Langfuse 只 index 含 LLM 框架 attribute 的 trace）
- **优化方向**：用 ag-ui `agent.subscribe` 监听 `onRunStartedEvent` 后才采 chip trace_id，而非 fetch requestHook 无差别抓
- **状态**：未做，Langfuse 自托管起来后问题更明显（Cloud 时 Langfuse 有延迟 ingestion 可能掩盖）
- **权威来源**：[`22` Phase 3 注记](./22-OBSERVABILITY-ENTERPRISE.md)

---

## 🟢 低优先级（非阻塞）

### Bug 8: LangGraph checkpoint deserialization warning

- **表现**：每次 restore agent state 时 warning:
  ```
  Deserializing unregistered type ag_ui.core.types.Context from checkpoint.
  This will be blocked in a future version.
  Add to allowed_msgpack_modules to silence: [('ag_ui.core.types', 'Context')]
  ```
- **影响**：当前只是 warn 不 fail；但 LangGraph 未来版本会 block
- **修法**：加 `allowed_msgpack_modules=[('ag_ui.core.types', 'Context')]` 到 `AsyncSqliteSaver` 配置
- **状态**：❌ **本次之前未记录**，添加到此索引后建议 spin-off 一个 P1 todo
- **建议 owner**：下次改 `agents/radar/src/radar/main.py` lifespan 的 AsyncSqliteSaver 时顺手修

### Bug 9: E2E 4 个测试历史失败

- **表现**：
  - `production Step 4: sync view renders clean`
  - `walkthrough Full walkthrough`
  - `mobile Step 6: tab switching`
  - `persistence`（sequential 全量跑超时，单跑 OK）
- **根因**：前 3 个 `button[aria-label="同步"]` selector 老问题；第 4 个机器负载高
- **状态**：非本次引入，长期存在
- **权威来源**：[`21-TECH-DEBT.md` P3 #10](./21-TECH-DEBT.md)

### Bug 10: 106 个 TypeScript implicitly-any 错误

- **位置**：`radar-store.ts` / `RadarWorkspace.tsx` / `InboxView.tsx` 等
- **状态**：项目长期存在，与 CopilotKit 升级无关
- **权威来源**：[`21-TECH-DEBT.md` P3 #11](./21-TECH-DEBT.md)

---

## 统计

- 上游 bug（等修）：4
- 下游补丁（我们盖住）：3（其中 1 条根因未严格验证，待 Phase 5 #2）
- 低优先级：3（1 条本次新记录）

---

## 维护约定

- **发现新 bug**：先加源文档（17/21/22/...），再追加本索引
- **bug 修复后**：源文档加 ✅ + commit hash，本索引直接删该条目
- **根因确认后**（比如 Phase 5 #2 做完对照实验）：更新 Bug 5 状态

## 文档地图

| 文档 | 职责 |
|---|---|
| `26-KNOWN-BUGS.md`（本文） | 已知 bug 集中索引 |
| `25-TODO.md` | 待办统一索引（bug 修复 + 新功能 + 架构缺口）|
| `21-TECH-DEBT.md` | 代码债务（会话持久化领域）|
| `22-OBSERVABILITY-ENTERPRISE.md` | observability 架构 + 28 风险表 |
| `17-AGUI-STREAMING-DEDUP.md` | AG-UI 事件去重的历史排查记录 |
