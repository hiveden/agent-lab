# 技术债清单

> 最后更新：2026-04-17（Phase 3 A1 完成后修订）
>
> 本文档聚焦**会话持久化相关**的技术债。梳理契机：Phase 1/2 + CopilotKit 1.56.2 升级 + 侧栏 bug fix + Phase 3 A1 五次连续改动后（commits a2bbc6b / 1e430bf / a177393 / 9b2069b / 22455ab / 108ece6）。
>
> 非会话领域的债（如 UI v2 遗留 trace 拖拽 bug、106 个 TS implicitly-any 错误、historical E2E flakiness）只在 P2/P3 简略记录。

## ✅ 已解决

### Phase 3 A1 - commit a2bbc6b
| 项 | 解决方式 |
|----|---------|
| **P0 #1 死代码 `_langchain_messages_to_dicts`** | 函数 + 7 个单测已删 |
| **P1 #3 双模式渲染半成品** | 数据源统一为 `agent.messages`；双 UI 渲染保留（这是产品语义：活跃可编辑 + 历史只读 input/preset 隐藏） |
| **P2 #9 Trace 构建两份重复** | `buildTraceFromPersistedMessages` 已删，统一 `buildTraceFromMessages(messages)` |

### 批量清理 - commit aa0878c
| 项 | 解决方式 |
|----|---------|
| **P1 #4 `SessionSummary.message_count`** | 字段删除 + `listAgentSessions` 不再 JOIN `chat_messages` |
| **P1 #5 Agent/Inbox type 拆分** | 新增 `AgentSessionMeta`（Agent 路径无 messages） / `InboxSessionHistory`（Inbox 路径含 messages），`SessionHistory` 保留为 deprecated 别名 |
| **P2 #7 `showDevConsole`** | 条件化为 `NODE_ENV === 'development'` |
| **P2 #8 `chat_messages` 表注释** | schema.ts 加 JSDoc 区分 Agent / Inbox 路径 |

### 文档精修 - 本次
| 项 | 解决方式 |
|----|---------|
| **P0 #2 文档章节正文过时** | 三份文档（19-SESSION-HISTORY-DESIGN / 19-COPILOTKIT-EVENT-FLOW / 20-LANGGRAPH-PERSISTENCE）章节正文对齐实际代码：加 "已解决" / "历史叙述" / "📌 现状" 标注；代码示例与 commit a2bbc6b / aa0878c 后的实际代码一致 |

## P0 阻塞 — 直接影响代码健康

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

**位置**：`apps/web/src/lib/hooks/use-agent-session.ts` + `apps/web/src/lib/chat.ts` 的 `SessionHistory` interface

**问题**：
- Hook 类型定义 `session.messages: PersistedMessage[]`（永远空或历史遗留）
- Phase 3 A1 后 SessionDetail 不再使用此字段（消息从 `agent.messages` 来）
- 但 `SessionHistory.messages` 仍被 `getLatestSessionForItem`（Inbox 会话体系）使用 — **不能直接删 type**

**修复方向**：先拆分 Agent 和 Inbox 的 session type
- 新增 `AgentSessionMeta`（无 messages）给 Agent 会话用
- 保留 `SessionHistory`（含 messages）给 Inbox 会话用
- `useAgentSession` 切换到 `AgentSessionMeta`
- `getSessionByThreadId` 返回 `AgentSessionMeta`

**工作量**：2-3h（涉及 type 拆分 + API 响应 + 相关 E2E 断言）

---

### 架构注释：两条会话路线（非技术债，并存设计）

> 此前此项被错误归为 P1 #6 "技术债"。经讨论修正：**两条会话路线是有意并存的 A/B 架构**，不是待清理的债务。记录在此仅用于建立正确的心智模型。

**两条路线**：

| 路线 | 产品入口 | 索引 | Chat 组件 | 消息存储 |
|-----|---------|------|---------|---------|
| **Inbox 会话**（老路线）| Inbox 列表点击单个 item 聊天 | `itemId` | AI SDK `useChat` + ChatView | D1 `chat_messages` 表 |
| **Agent 会话**（新路线）| Agent 页面自由对话 | `threadId` | CopilotKit `useAgent` + CopilotChat | LangGraph AsyncSqliteSaver |

**隐性约束**：
- `chat_messages` 表是 Inbox 专属，Agent 路线不写（见 `schema.ts` 注释）
- 两个 API 路径：`POST /api/chat`（Inbox）vs `POST /api/agent/chat`（Agent）
- 前端 state：Zustand `sessions[itemId]`（Inbox）vs `useAgent().messages`（Agent）
- 元数据：共享 `chat_sessions` 表（通过 `agent_id` 区分）

**何时考虑合并**：产品层面决定 Inbox 和 Agent 对话能力要不要统一（tool 调用、checkpointer 恢复、trace 可见等 Agent 路线的能力是否需要下沉到 Inbox）。这是产品决策，不是重构决策。

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

### ✅ 阶段 1 已完成
- P0 #1 删死代码 `_langchain_messages_to_dicts`（commit a2bbc6b）
- P2 #9 Trace 构建统一（commit a2bbc6b）
- P1 #3 双模式产品决策（commit a2bbc6b，选 A1）

### 阶段 2：剩余短期清理（0.5-1 天）
- P1 #4 删 `SessionSummary.message_count` 字段（~1h，但要动 chat.ts preview 降级逻辑）
- P1 #5 拆分 Agent / Inbox 的 session type（2-3h，跨体系）
- P2 #7 条件化 `showDevConsole`（10min）
- P2 #8 加注释说明 `chat_messages` 表归属（30min）

### 架构演进（产品决策后触发，非技术债）
- Inbox vs Agent 两条会话路线：是否要产品层面统一（见"架构注释"章节）
