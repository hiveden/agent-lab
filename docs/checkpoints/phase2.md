# Phase 2 验证记录 — 2026-04-17

## 目标

根治消息重复 bug — 让 LangGraph checkpointer 成为对话消息的 single source of truth，删除自研全量 persist 逻辑。

## 改动文件

### Python

- `agents/shared/src/agent_lab_shared/db.py` — `PlatformClient.persist_chat` 删除 `messages` 参数
- `agents/radar/src/radar/agui_tracing.py` — `_persist_chat` 不再传 messages，只发 config_prompt + result_summary

### BFF

- `apps/web/src/app/api/chat/persist/route.ts` — 删除 `insertMessage` 循环，只保留 `ensureSession` + `updateSessionMetadata`
- `apps/web/src/app/api/chat/persist/schema.ts` — 新增，Zod schema 从 route.ts 抽出便于单测
- `apps/web/src/app/api/chat/persist/route.ts` — 从 schema.ts import `persistBodySchema`

### 前端

- `apps/web/src/app/agents/radar/components/production/SessionDetail.tsx` — 删除 mount-time `setMessages` useEffect（第 296-305 行）

### 测试

- `agents/radar/tests/test_persist_chat.py` — 更新 4 个 TestPersistChat 用例（去掉 messages 参数）+ 1 个 TestAgentPersistChat（断言 messages 字段不再传）
- `apps/web/__tests__/api/chat-persist-schema.test.ts` — 新增 7 个 Vitest 用例（断言 schema 无 messages 字段）
- `apps/web/e2e/persistence.spec.ts` — 新增 E2E（刷新前后消息数精确一致 + D1 chat_messages 为空）
- `apps/web/playwright.config.ts` — 加 `persistence` project

## 验证结果

### pytest

```
139 passed in 46.75s
```

### Vitest

```
2 Test Files passed (2)
23 Tests passed (23) in 141ms
```

### Playwright E2E

```
[E2E] before reload: user=3, assistant=7
[E2E] after reload:  user=3, assistant=7
1 passed (54.5s)
```

### 核心 bug 根治验证

| 维度 | 验证方式 | 结果 |
|------|---------|------|
| 消息无膨胀 | 刷新前后 DOM bubble 数一致 | ✅ user=3 / assistant=7 精确一致 |
| D1 不再写消息 | GET /api/chat/sessions?thread_id=X 查 messages | ✅ `session.messages.length = 0` |
| CopilotKit 自动恢复 | 刷新后 DOM 仍渲染消息 | ✅ 通过 MESSAGES_SNAPSHOT 自动恢复 |
| 元数据正常 | config_prompt + result_summary 写入 chat_sessions | ✅（未直接断言，但 persist 调用路径已验证）|

## 重要观察

1. **preset "执行评判" 产生 2+ 条 assistant bubble** — 因为 ReAct agent 先输出 thinking（带 tool_call），执行 evaluate tool，然后 final response。一轮 preset 对应多条 assistant 消息，这是正常的 agent 行为，不是膨胀
2. **CopilotKit 输入 textarea 点击"发送"按钮在测试中发送失败** — 根因未深究，用 preset 绕过（preset 直接调 `agent.addMessage + runAgent`，不走 CopilotKit 输入组件事件链）。后续测试都走 preset 路径
3. **`MESSAGES_SNAPSHOT` 事件已经稳定发射** — Phase 3 POC 有较高成功预期

## 已知退化（符合 doc 20 §8.5 搁置预案）

- 历史会话（切换到旧 thread）的只读消息列表现在为空，因为 `chat_messages` 表不再写入
- 历史 `config_prompt` + `result_summary` 仍可正常展示
- 完整历史消息查看待 Phase 3 POC 验证 CopilotKit AG-UI thread 支持后修复

## 遗留 / 下一步

- **Phase 3 POC** — 验证 CopilotKit 能否正确处理切换到历史 threadId 的恢复链路
  - 如果通过：统一历史浏览为 CopilotKit 恢复模式
  - 如果失败：保留双模式渲染，用户理解"历史只看摘要"
- `_langchain_messages_to_dicts` 函数现在是死代码但尚未删除（TestLangchainMessagesToDicts 用例仍依赖它），待 Phase 4 清理时一并处理

## 关联文档

- [docs/20-LANGGRAPH-PERSISTENCE.md](../20-LANGGRAPH-PERSISTENCE.md) §5 Phase 2 + §8.4 测试方案
- [docs/checkpoints/phase1.md](./phase1.md) 上一步
