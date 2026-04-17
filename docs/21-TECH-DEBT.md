# 技术债清单

> 最后更新：2026-04-17
>
> 本文档聚焦**会话持久化相关**的技术债。梳理契机：Phase 1/2 + CopilotKit 1.56.2 升级 + 侧栏 bug fix 四次连续改动后（commits a177393 / 9b2069b / 22455ab / 108ece6）。
>
> 非会话领域的债（如 UI v2 遗留 trace 拖拽 bug、106 个 TS implicitly-any 错误、historical E2E flakiness）只在 P2/P3 简略记录。

## P0 阻塞 — 直接影响代码健康

### P0 #1 死代码：`_langchain_messages_to_dicts`

**位置**：`agents/radar/src/radar/agui_tracing.py:36-72`

**问题**：Phase 2 后 `_persist_chat` 不再调此函数。36 行代码 + 8 个单元测试（`TestLangchainMessagesToDicts`、部分 `TestAgentPersistChat`）纯粹是历史包袱。

**风险**：新开发者看到函数会以为它仍然是持久化链路的一部分，产生理解偏差。

**修复**：
- 删除函数 + 测试类
- 验证 pytest 全绿
- 估算工作量：30min

---

### P0 #2 文档 - 代码不一致

**问题**：三个文档有演进提示但内容未全量更新，阅读体验割裂。

| 文档 | 状态 |
|------|------|
| `docs/19-SESSION-HISTORY-DESIGN.md` | ✅ 已加 header 演进说明（2026-04-17）|
| `docs/19-COPILOTKIT-EVENT-FLOW.md` | ✅ 已加 header 演进说明（2026-04-17）|
| `docs/20-LANGGRAPH-PERSISTENCE.md` | ✅ Phase 3/4 状态已更新 |

**残留**：§ 具体章节内仍有与现实不符的代码示例、架构图。后续需要精修各章节，或用"现状 vs 历史"的对比 frame 重写。

---

## P1 应修 — 代码债务

### P1 #3 双模式渲染半成品

**位置**：
- `apps/web/src/app/agents/radar/components/production/AgentView.tsx:18-32`（`activeIdRef` + `isActiveSession` 计算）
- `apps/web/src/app/agents/radar/components/production/SessionDetail.tsx` 多处条件分支

**问题**：
- `isActiveSession=true`（刚创建 / 刷新后的活跃会话）→ 渲染 CopilotChat 可交互
- `isActiveSession=false`（切到历史会话）→ 渲染只读消息列表，但 `session.messages` 来自 `useAgentSession`，Phase 2 后永远为空数组 → 用户看到"无对话记录"空白

**阻塞点**：这是半成品，需要产品决策：
- **A**：完成 Phase 3 — 历史会话也走 CopilotChat（`MESSAGES_SNAPSHOT` 恢复），砍双模式
- **B**：明确"历史 = 配置快照 + 结果摘要"产品定位，砍双模式代码 + 更新 UI 文案

**工作量**：A 估 4-8h（含 POC + E2E），B 估 2-3h

**关联**：见 [`20-LANGGRAPH-PERSISTENCE.md`](./20-LANGGRAPH-PERSISTENCE.md) Phase 3。

---

### P1 #4 `SessionSummary.message_count` 字段无用但仍查询

**位置**：
- `apps/web/src/lib/hooks/use-session-list.ts:9` 定义 `message_count: number`
- `apps/web/src/lib/chat.ts:151-165` `listAgentSessions` 每个 session 做一次 `SELECT id, role, content FROM chat_messages WHERE session_id = ?`
- `apps/web/src/app/agents/radar/components/production/SessionSidebar.tsx` **UI 完全不使用这个字段**

**问题**：
- 每列一个 session 多一次 DB 查询
- 查询结果除了取 `firstUser?.content.slice(0, 50)` 作为 preview fallback 外，`msgs.length` 纯浪费
- Phase 2 后 `chat_messages` 只有遗留数据，preview fallback 的价值也极低

**修复方向**：
- 删除 `message_count` 字段（hook + SessionSummary type）
- `listAgentSessions` 只保留一次 `SELECT` 拿 session 元数据
- preview 只走 `config_prompt` / `result_summary` 两级降级（删除 `firstUser?.content` fallback）

**工作量**：1h

---

### P1 #5 `useAgentSession.messages` 永远为空数组

**位置**：`apps/web/src/lib/hooks/use-agent-session.ts`

**问题**：
- Hook 类型定义 `session.messages: PersistedMessage[]`
- Phase 2 后 `chat_messages` 表不再写入，`getSessionByThreadId` 返回的 messages 始终是历史遗留数据或空数组
- SessionDetail 中历史分支使用这个字段渲染 → 永远空白

**修复取决于 P1 #3 的决策**：
- 若选 A：改 `useAgentSession` 或让 SessionDetail 不依赖此字段
- 若选 B：删除 `messages` 字段（API 只返回元数据），简化 type

---

### P1 #6 遗留 Zustand `sessions` slice（Inbox 会话体系）

**位置**：`apps/web/src/lib/stores/radar-store.ts:272-319`（`loadSession` / `updateSession`）

**问题**：
- 项目有**两套并行**的会话体系：
  - Inbox 会话：`itemId` 索引，存在 Zustand `sessions[itemId]`，走 D1 `chat_messages` 表（老路径，仍在写入）
  - Agent 会话：`threadId` 索引，走 LangGraph checkpointer（新路径）
- Inbox 这边 **仍然依赖 `chat_messages` 表**（通过 `/api/chat/sessions/{itemId}` 和 `getLatestSessionForItem`）
- Phase 2 只改了 Agent 端持久化，Inbox 端没动
- 双轨制是隐性约束：`chat_messages` 表不能彻底删除（Inbox 还在用）

**原因**：Inbox 对话用 AI SDK `useChat` hook + Next.js route，不是 CopilotKit。没有 checkpointer。

**修复方向**：
- 短期：文档化这是"两套体系"，`chat_messages` 表是 Inbox 专属
- 长期：若统一为 CopilotKit，可移除 Zustand sessions slice + AI SDK

**工作量**：短期 0h（只记录），长期 1-2 天（重写 Inbox 会话）

---

## P2 优化

### P2 #7 生产环境 `showDevConsole` 仍开

**位置**：`apps/web/src/app/agents/radar/components/production/AgentView.tsx:53`

```typescript
<CopilotKit key={threadId} runtimeUrl="/api/agent/chat" showDevConsole>
```

**修复**：`showDevConsole={process.env.NODE_ENV === 'development'}` 或类似

**工作量**：10min

---

### P2 #8 `chat_messages` 表保留但不再由 Agent 链路写入

**位置**：`apps/web/src/lib/db/schema.ts:62-77`

**问题**：
- Agent 链路不再写
- Inbox 链路（见 P1 #6）仍在写
- 新开发者容易误会

**修复方向**：见 P1 #6 决策后，文档注释表的所有权

**工作量**：30min（加注释）

---

### P2 #9 Trace 构建两份重复逻辑

**位置**：`apps/web/src/app/agents/radar/components/production/SessionDetail.tsx`
- `buildTraceFromMessages`（L78-188）— AG-UI Live 消息
- `buildTraceFromPersistedMessages`（L192-252）— 历史持久化消息

**问题**：两函数 90% 逻辑相同，数据源不同（Message 对象 vs PersistedMessage 对象）

**修复取决于 P1 #3**：若选 B 砍双模式，第二个函数可直接删除

**工作量**：B 路径下 10min，A 路径下 1h

---

## P3 可选 / 非会话领域

### P3 #10 E2E 4 个历史失败

测试：
- `production Step 4: sync view renders clean`
- `walkthrough Full walkthrough`
- `mobile Step 6: tab switching, each view visual clean`
- `persistence` — 全量跑时超时（单跑 OK）

**根因**：
- 前 3 个：`button[aria-label="同步"]` selector 找不到或超时（老问题，非本次改动引入）
- 第 4 个：sequential 全量跑时机器负载高，agent run 超时

**非本次阻塞**。

### P3 #11 106 个 TypeScript `implicitly-any` 错误

**位置**：`radar-store.ts`、`RadarWorkspace.tsx`、`InboxView.tsx` 等

**状态**：项目已有，与 CopilotKit 升级无关（升级前后错误数一致）

**非本次阻塞**。

### P3 #12 zustand 5.x 兼容性

**说明**：commit 9b2069b 补齐了 `zustand@^5.0.0` 显式依赖，但项目代码原本为 4.x/3.x 写法。5.x 有一些 create 签名变化（`create<T>()(fn)` vs `create<T>(fn)`），已验证运行但没有系统性检查所有 API 调用。

**非本次阻塞**，运行正常即可。

---

## 清理路线图建议

### 阶段 1：零成本清理（0.5 天）
- P0 #1 删死代码 `_langchain_messages_to_dicts`
- P1 #4 删 `message_count` 字段
- P2 #7 条件化 `showDevConsole`
- P2 #8 加注释说明 `chat_messages` 表归属

### 阶段 2：产品决策（0.5-1 天讨论 + 相应实施）
- P1 #3 决定双模式去留（A / B 选项）
- P1 #5 跟随决策做
- P2 #9 跟随决策做

### 阶段 3：架构收敛（长期）
- P1 #6 Inbox 会话体系是否统一为 CopilotKit
