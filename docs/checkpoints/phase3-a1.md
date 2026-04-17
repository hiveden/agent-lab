# Phase 3 A1 验证记录 — 2026-04-17

## 目标

打通"反馈循环"关键闭环 — 切换到侧栏历史 session 时，消息列表和 trace 面板完整恢复（此前 Phase 2 后历史会话只能看配置快照，对话部分空白）。

A1 选项含义（docs/20-LANGGRAPH-PERSISTENCE.md §5 Phase 3）：
- 历史会话走 CopilotKit 的 MESSAGES_SNAPSHOT 恢复（不是新写 D1 读取逻辑）
- 保留双模式 UI：活跃可编辑 + 历史只读（input / preset 不渲染）
- 数据源统一：trace / resultBatches / 消息列表全部来自 `agent.messages`

## 改动文件

### 前端核心

- `apps/web/src/app/agents/radar/components/production/SessionDetail.tsx`
  - trace / resultBatches 数据源统一为 `agent.messages`（删除 `session?.messages` / `session.result_summary` fallback）
  - 历史会话只读渲染从 `session.messages` 改为 `agent.messages`（过滤空 content）
  - 新增 useEffect 手动调 `useCopilotKit().copilotkit.connectAgent({ agent })` — 活跃会话由 CopilotChat 自己触发，历史只读分支必须手动触发才能获得 MESSAGES_SNAPSHOT
  - 删除 `buildTraceFromPersistedMessages` 函数（63 行，本次统一后无调用）
  - 删除 `PersistedMessage` import（死引用）

- `apps/web/src/app/agents/radar/components/production/SessionSidebar.tsx`
  - 每项添加 `data-thread-id` 属性便于 E2E 精确定位

### 后端清理

- `agents/radar/src/radar/agui_tracing.py` — 删除 `_langchain_messages_to_dicts` 函数（36 行，Phase 2 后无调用）
- `agents/radar/tests/test_persist_chat.py` — 删除 `TestLangchainMessagesToDicts` 测试类（7 个用例）

### E2E

- `apps/web/e2e/history-session-recovery.spec.ts` — 新增 A→B→切回 A 场景
- `apps/web/playwright.config.ts` — 加 history-recovery project

## 关键技术认知

### CopilotKit MESSAGES_SNAPSHOT 触发链路

```
<CopilotChat> mount → useEffect 调 copilotkit.connectAgent({ agent })
  → 后端 ag-ui-langgraph 收到 connect 请求
  → prepare_stream → graph.aget_state(thread_id)
  → 发 MESSAGES_SNAPSHOT 事件（含 checkpointer 里的全部 messages）
  → 前端 agent.messages 被填充
  → 组件重渲染（trace / 消息列表都来自 agent.messages）
```

**关键点**：connectAgent 只由 `<CopilotChat>` 的 useEffect 自动触发。历史只读分支不渲染 CopilotChat → 必须手动调 connectAgent，否则 agent.messages 永远空（这是 POC 第一次失败的根因）。

### 活跃 vs 历史的 assistant 数差异

| 场景 | user | assistant | 原因 |
|------|------|-----------|------|
| 活跃（CopilotChat）| N | >=N | CopilotChat 对空 content 的 AI 消息（只有 tool_calls 的 thinking）也渲染气泡（thinking dots）|
| 历史（只读视图）| N | N | 本组件过滤掉空 content 消息，只渲染 final response |

**这是产品意图**：历史视图用户不需要看"思考中"气泡，看 final response + trace 就够。

### SessionHistory.messages 字段保留原因

未清理 `SessionHistory.messages` 字段，因为 `getLatestSessionForItem`（Inbox 会话体系）仍在用。Inbox 会话走 `chat_messages` 表（AI SDK useChat 路径），不走 checkpointer。强行清理会破坏 Inbox 功能。

需要 Phase 4 里先拆 Agent 和 Inbox 的 session type，再分别清理。

## 验证结果

### pytest

```
132 passed in 44.30s
```

（从 139 降到 132，删了 7 个 TestLangchainMessagesToDicts 测试）

### Vitest

```
2 Test Files passed (2)
23 Tests passed (23)
```

### Playwright 三 spec 联跑

```
✓ persistence            user=3/assistant=7 前后一致
✓ session-list (x2)      preview 降级正确
✓ history-session-recovery   A(u=2/a=4) → B(u=1) → A(u=2/a=2)
4 passed (2.1m)
```

## 关联文档

- `docs/20-LANGGRAPH-PERSISTENCE.md` §5 Phase 3 A1 描述
- `docs/21-TECH-DEBT.md` — A1 解决了 P0 #1、P1 #3（部分）、P2 #9
- `docs/checkpoints/phase1.md` / `phase2.md`
