# 会话历史 — 技术方案

> **⚠️ 架构已演进（2026-04-17）** — Phase 1/2 实施完成后，本文档部分章节已过时：
>
> **当前实际架构**：
> - 消息（`messages`）持久化 = LangGraph `AsyncSqliteSaver`（`agents/radar/data/checkpoints.db`），详见 [`20-LANGGRAPH-PERSISTENCE.md`](./20-LANGGRAPH-PERSISTENCE.md)
> - 会话元数据（`config_prompt` / `result_summary`）= D1 `chat_sessions` 表
> - D1 `chat_messages` 表**不再写入**（遗留，向后兼容旧数据）
> - 刷新页面后活跃会话的消息通过 CopilotKit `MESSAGES_SNAPSHOT` 事件自动恢复
>
> **仍然有效**：§1 产品需求、§2.3 AgentView 架构问题、§4 组件架构（已实施）、§5 模块设计
>
> **已过时**：§2.4 持久化缺口（已由 checkpointer 解决）、§3 Session 数据模型中 messages 字段的读写路径、§6 后端变更（Python 端 `_persist_chat` 不再传 messages，只传元数据；BFF persist 不再调 insertMessage）、§9.3 历史消息格式兼容（checkpointer 内部 LangChain 对象，不需要格式转换）
>
> **新发现的半成品（2026-04-17）**：Phase 2 后历史会话切换只能看配置快照（`useAgentSession.messages` 返回空数组）。`AgentView.isActiveSession` 双模式渲染代码仍然保留但语义不完整。详见 [`21-TECH-DEBT.md`](./21-TECH-DEBT.md) P1 #4。

## 1. 产品需求分析

### 1.1 从产品哲学推导

Radar 的本质是**认知之镜**（`docs/01-PHILOSOPHY.md`），Agent 页面是用户调校这面镜子的操作台。

Intelligence 模块的设计共识定义了核心交互：

- **提示词编辑器** — 用户写"关注什么、过滤什么、怎么摘要"
- **执行透明度** — 展示 Agent 怎么执行提示词（过滤了什么、为什么推荐）
- **反馈循环** — 看到推送结果不满意 → 改提示词 → 再跑

Agent 页面设计方向明确了两期演进：

| | 本期：执行控制台 | 下期：对话工作台 |
|---|---|---|
| 主交互 | 按钮触发 evaluate | Chat 为主入口 |
| "会话"的含义 | 一次执行上下文 | 一个对话线程 |
| 配置 | 编辑 → 跑 → 看结果 | 通过对话动态调整 |
| Chat 的角色 | 辅助（预设快捷方式） | 主角 |

### 1.2 用户场景

**S1：刷新页面继续对话**
用户昨天让 agent 评判了一批内容，今天打开页面想看结果。
→ 需要 threadId 持久化 + 消息历史加载。

**S2：回看上次评判的配置和结果**
用户想知道"上次推了什么？是什么配置跑出来的？"
→ 需要配置快照关联到 session + 结果摘要。

**S3：对比不同配置的评判效果**
用户调整了提示词，想和上次的结果做对比。
→ 需要会话列表 + 点击切换 + 历史会话展示当时的配置和结果。

**S4：看历史评判的执行过程**
用户想知道"为什么这条被过滤了？"
→ 需要 trace（tool call 的 input/output）持久化。

### 1.3 功能约束

#### 做什么

1. **保存执行上下文** — 每次 agent run 形成一个 session，包含配置快照 + 评判结果摘要 + 消息记录 + trace 数据
2. **会话列表可回顾** — 一眼看到每次执行的时间、结果摘要（推了几条、过滤了几条）
3. **点击历史 = 只读回顾** — 查看当时的配置、结果、trace，支持反馈循环中的"对比"环节
4. **当前会话可续写** — 最新的活跃会话保持 live 状态，可以继续对话和执行
5. **历史 trace 可回看** — tool call 的 input/output 持久化，历史会话可重建 trace

#### 不做什么

1. **不做历史会话续写** — 回到旧会话继续发消息没有产品意义。配置已变，agent context 已不同，续写会产生混乱。要调整就用当前配置开新会话。
2. **不做配置回滚** — 快照是只读参考（"当时怎么配的"），不提供"恢复到那个配置"的按钮。用户看完快照后手动调 ConfigCards 是更安全的路径。
3. **不做对话搜索/分类/标签** — 效率至上（哲学原则 3），不给单用户产品增加管理负担。
4. **不做会话导出/分享** — 单用户产品。
5. **不做跨设备同步** — localStorage 不跨设备，但可通过列表手动切换。

#### 配置快照粒度

存 `buildPromptFromCards()` 的结果字符串，不存 ConfigCards JSON。

- 快照的目的是回答"当时用了什么配置"，不是"回滚到那个配置"
- 结果字符串就是 Agent 实际看到的 prompt，是最真实的记录
- 存 JSON 需要渲染 ConfigCards 只读版本 — 增加复杂度但不增加产品价值
- 在历史详情里用折叠文本区域展示即可

## 2. 现有架构分析

### 2.1 前端整体结构

```
RadarWorkspace（状态中枢）
  ├─ Zustand store（6 slices，persist middleware）
  ├─ SWR hooks（useItems, useRuns — 声明式数据获取）
  ├─ 条件渲染视图：
  │    activeView==='agent'     → <AgentView />      ← CopilotKit Provider 自包含
  │    activeView==='inbox'     → <InboxView />       ← store.sessions + AI SDK useChat
  │    activeView==='sources'   → <RunsView />
  │    activeView==='attention' → <AttentionView />
  │    activeView==='settings'  → <SettingsView />
  └─ NavRail（导航） / CommandPalette（⌘K）
```

### 2.2 两套会话体系

> **📌 现状更新（Phase 3 A1 后）**：两套体系依然并存，但消息存储介质已分化 — Inbox 继续写 D1 `chat_messages`，Agent 改由 LangGraph checkpointer 独占。

| 维度 | Inbox 会话（已实现） | Agent 会话（Phase 3 A1 后） |
|------|---------------------|----------------------|
| **索引键** | `itemId`（每个推荐条目一个会话） | `threadId`（独立对话线程） |
| **状态存储** | Zustand `sessions[itemId]` | `useAgentSession` SWR hook（元数据）+ `useAgent().messages`（消息） |
| **数据获取** | `store.loadSession(itemId)` → `GET /api/chat/sessions/{itemId}` | `GET /api/chat/sessions?thread_id=xxx`（只取元数据） |
| **聊天组件** | AI SDK `useChat` hook（ChatView） | CopilotKit `useAgent` + `CopilotChat` |
| **持久化触发** | BFF `/api/chat` route 内 `insertMessage()` | **消息**：LangGraph `AsyncSqliteSaver` 每步自动 checkpoint；**元数据**：Python `_persist_chat()` fire-and-forget 只发 `config_prompt + result_summary` → `/api/chat/persist` |
| **消息存储** | D1 `chat_messages` 表 | `agents/radar/data/checkpoints.db`（LangGraph checkpointer，独立文件）|
| **元数据存储** | `chat_sessions`（沿用） | `chat_sessions`（仅 `config_prompt` / `result_summary`，不再写 `chat_messages`） |
| **会话列表** | 不需要（1 item = 1 session） | 需要（多轮独立执行） |
| **Provider** | 无（直接 fetch） | `<CopilotKit>` Provider tree |

### 2.3 AgentView 架构问题

`AgentViewInner` 是 547 行的 god component，混合了 6 个不同关注点：

| 关注点 | 行数 | 问题 |
|--------|------|------|
| 会话身份（threadId） | `:212` | 与 UI 逻辑耦合 |
| Agent 生命周期（useAgent、Inspector bridge） | `:215-234` | 和布局混在一起 |
| 配置管理（ConfigCards、useAgentContext） | `:241-246` | 全局 localStorage，不属于会话 |
| 结果提取（extractResultBatches） | `:92-137` | 模块级函数，仅此组件用 |
| Trace 构建（buildTraceFromMessages） | `:141-202` | 同上 |
| 布局渲染（3 panel 折叠、resize、侧栏） | `:248-535` | 占 60%，和业务逻辑耦合 |

**核心问题：没有"会话"这个概念的抽象。** threadId、messages、config、results、trace 散落在组件各处，没有聚合成 session 对象。导致：

- 无法把右侧内容区作为"会话详情"复用
- 侧栏和详情区耦合在同一个 render 函数里
- 切换会话 = remount 整个组件 = 丢失所有派生状态

### 2.4 持久化缺口（✅ 已解决 — 历史问题，Phase 1/2 前）

> **⚠️ 历史叙述** — 以下问题是 Phase 2 前 D1 `chat_messages` 单一存储路径下的缺口。Phase 1（配置/结果摘要写入）+ Phase 2（LangGraph checkpointer 接管消息存储）之后，本节所列问题全部消失：tool messages / tool_calls 由 checkpointer 以 LangChain `BaseMessage` 对象原生存储，零格式损失；`config_prompt` / `result_summary` 由 `_persist_chat` 提取后单独持久化到 `chat_sessions`。详见 [`20-LANGGRAPH-PERSISTENCE.md`](./20-LANGGRAPH-PERSISTENCE.md)。

Python `_persist_chat()` 通过 `_langchain_messages_to_dicts` 转换消息，当前逻辑：

- ✅ 保留 `role=user` / `role=assistant` 的文本内容
- ❌ 过滤 `role=tool` 消息（丢失 tool 执行结果）
- ❌ 不保留 assistant 消息上的 `tool_calls` 数组（丢失 tool 调用参数）
- ❌ 不保存配置快照
- ❌ 不保存结果摘要

导致持久化后只剩对话文本，丢掉了会话最有价值的部分。

### 2.5 现有 hooks 组织

```
apps/web/src/lib/hooks/
  ├─ use-items.ts          SWR — 推荐列表
  ├─ use-runs.ts           SWR — 运行记录
  ├─ use-theme.ts          主题切换
  ├─ useMediaQuery.ts      响应式断点
  └─ useDwellTracker.ts    隐式停留时间
```

数据获取混用三种模式：

| 模式 | 用于 | 特征 |
|------|------|------|
| **SWR hooks** | Items / Runs 列表 | 声明式、自动缓存、key-based 失效 |
| **Store actions** | Session 加载、状态批量更新 | 命令式、结果写入 Zustand |
| **组件内 fetch** | MobileChatView SSE 流 | 手动流解析 |

## 3. Session 数据模型

### 3.1 完整定义

> **📌 当前实际定义（Phase 3 A1 后，commit aa0878c）** — `messages` 字段已从 `AgentSession` 中移除。消息由 LangGraph checkpointer 持有，前端通过 `useAgent().messages` 访问；本 interface 只描述"会话元数据"。定义位于 `apps/web/src/lib/hooks/use-agent-session.ts`：

```typescript
// 当前实际类型（Phase 3 A1 后）
interface AgentSession {
  session_id: string;                   // threadId
  config_prompt: string | null;         // buildPromptFromCards() 结果
  result_summary: ResultSummary | null; // { evaluated, promoted, rejected }
}
```

历史 / 设计时的完整形态（仅供参考，已不适用）：

```typescript
// ⚠️ 过时：原设计将 messages 内联在 AgentSession 内
interface AgentSession {
  id: string;                    // threadId
  agent_id: string;
  created_at: string;

  // 会话内容（user + assistant + tool 消息）—— 现已移除，改由 checkpointer 存
  messages: PersistedMessage[];

  // 执行上下文：创建时的配置快照
  config_prompt: string | null;  // buildPromptFromCards() 结果

  // 执行结果摘要（从 tool call result 提取）
  result_summary: {
    evaluated: number;
    promoted: number;
    rejected: number;
  } | null;
}

interface PersistedMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  tool_calls?: ToolCallRecord[] | null;  // assistant 消息上的 tool 调用
  tool_call_id?: string | null;          // tool 消息的关联 ID
  created_at: string;
}

interface ToolCallRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
}
```

### 3.2 各字段来源与持久化方式

> **📌 现状（Phase 3 A1 后）** — `messages` 不再由 `_persist_chat` 写入 D1；LangGraph `AsyncSqliteSaver` 在每个 graph step 结束时自动写 checkpoint 到 `agents/radar/data/checkpoints.db`。`_persist_chat` 只负责元数据提取。

| 字段 | 写入时机 | 写入方 | 存储位置 |
|------|---------|--------|---------|
| `messages`（LangChain `BaseMessage`） | 每个 graph step 结束 | LangGraph `AsyncSqliteSaver` 自动写 | `agents/radar/data/checkpoints.db`（SQLite，按 thread_id 索引） |
| `config_prompt` | agent run 结束 | Python `_persist_chat`（从 agent state 中提取） | D1 `chat_sessions.config_prompt` |
| `result_summary` | agent run 结束 | Python `_persist_chat`（从 evaluate tool result 提取） | D1 `chat_sessions.result_summary` |

**单一写入方原则（仍然适用，微调）：** 元数据（`config_prompt` / `result_summary`）仍由 Python `_persist_chat` 统一写入，前端只读。消息的单一写入方从"Python `_persist_chat`"下沉到"LangGraph checkpointer"（Python 进程内），前端不接触消息持久化。两层都遵循架构约束"Agent Server 处理 → BFF / checkpointer 持久化"的单向数据流，避免 split-brain。

### 3.3 持久化后如何支持各场景

| 场景 | 数据来源（Phase 3 A1 后） |
|------|---------|
| S1 刷新续对话 | CopilotKit 连接 agent 时自动收到 `MESSAGES_SNAPSHOT` 事件（checkpointer 回放），`agent.messages` 自行恢复，**前端无需手动 `setMessages()`** |
| S2 回看配置 | `useAgentSession` → `session.config_prompt` 文本展示 |
| S3 对比结果 | `useAgentSession` → `session.result_summary` 在会话列表（`useSessionList`）和详情中展示 |
| S4 看执行过程 | `agent.messages`（含 tool_calls + tool role）通过 `buildTraceFromMessages()` 构建 trace — 活跃 / 历史同源 |

## 4. 组件架构

### 4.1 拆分方案

> **📌 实施差异（commit a2bbc6b / A1）** — 原设计暗示把"活跃会话"和"历史会话"拆成两个组件（`ActiveSession` + `HistoryView`）。实际实施采用 A1：**保留单一 `SessionDetail` + 双模式条件渲染**（通过 `isActiveSession` 判断），而不是拆分两个组件。原因：两种模式共享 90% 的布局与数据管道（ConfigCards / ResultsPane / Trace / messages 来源都一致，只是开关可编辑性），代码复用更高；拆分反而引入跨组件状态同步的负担。

```
AgentView（外壳 — Provider + 状态提升）
  ├─ usePersistedThread()           → { threadId, resetThread, switchThread }
  ├─ useSessionList('radar')        → { sessions, reload }
  │
  ├─ <SessionSidebar />             ← 独立组件
  │    props: sessions, activeId, onNew, onSwitch, loading
  │
  └─ <CopilotKit key={threadId}>
       └─ <SessionDetail />          ← 可复用详情组件
            ├─ useAgent({ threadId })
            ├─ useAgentSession(threadId)  ← SWR hook（缓存 + 自动 refetch）
            │
            │  活跃会话（threadId === 当前）：
            ├─ ConfigCards（可编辑）
            ├─ ResultsPane（live 从 messages 提取）
            ├─ CopilotChat（可交互）
            └─ TraceDrawer（live 从 messages 构建）
            │
            │  历史会话（只读）：
            ├─ ConfigSnapshot（折叠文本）
            ├─ ResultsPane（从 session.result_summary 展示）
            ├─ MessageList（只读渲染）
            └─ TraceDrawer（从持久化 messages 重建）
```

### 4.2 SessionSidebar

独立组件，不依赖 CopilotKit Provider。

```typescript
interface SessionSidebarProps {
  sessions: SessionSummary[];
  activeId: string;
  loading: boolean;
  onNew: () => void;              // → resetThread()
  onSwitch: (id: string) => void; // → switchThread(id)
}

interface SessionSummary {
  id: string;
  agent_id: string;
  created_at: string;
  message_count: number;
  preview: string;                // 首条用户消息前 50 字符
  result_summary: {               // 后端新增返回
    evaluated: number;
    promoted: number;
    rejected: number;
  } | null;
}
```

显示内容：
- 每条：时间（相对） + preview + 结果摘要（如"推 3 / 滤 7"）
- 活跃会话高亮 + running 指示器
- 顶部"+ 新会话"按钮

### 4.3 SessionDetail

CopilotKit Provider 内的主内容区。根据是否为活跃会话，渲染不同模式：

> **📌 实施要点（A1 后）** — 活跃 / 历史两种模式的消息数据来源**同为 `agent.messages`**（由 CopilotKit `MESSAGES_SNAPSHOT` 从 checkpointer 恢复），不再有"live messages vs 持久化 messages"的二分。历史模式需要前端手动触发 `connectAgent(threadId)` 以触发 checkpointer 回放，活跃模式由 CopilotKit 自动连接。

| 区域 | 活跃会话 | 历史会话（只读） |
|------|---------|---------------|
| **配置** | `<ConfigCards />` 可编辑 | `<ConfigSnapshot prompt={session.config_prompt} />` 折叠文本 |
| **结果** | `<ResultsPane>` 从 `agent.messages` 提取 `extractResultBatches()` | `<ResultsPane>` 从 `session.result_summary` 静态展示 |
| **对话** | `<CopilotChat>` 可交互 + preset 按钮 | 只读消息列表（渲染 `agent.messages`，隐藏输入框 / preset） |
| **Trace** | `<TraceDrawer>` 从 `agent.messages` 构建 | `<TraceDrawer>` 从 `agent.messages` 构建（同源） |

**判断依据：** `threadId === usePersistedThread().threadId`（当前活跃 ID）时为活跃模式，否则为只读。

### 4.4 活跃 vs 历史的切换

```
用户点击侧栏历史会话
  → switchThread(oldId)
  → SWR key 变化 → useAgentSession 加载（或命中缓存）
  → CopilotKit remount
  → 检测到不是活跃会话 → 渲染只读模式
  → buildTraceFromMessages(messages) 重建 trace
  → 展示 config_prompt + result_summary

用户点击"+ 新会话"
  → resetThread()
  → SWR key 变化 → useAgentSession 返回空
  → CopilotKit remount
  → 检测到是活跃会话 → 渲染可交互模式
  → ConfigCards 可编辑 + CopilotChat 可输入
```

## 5. 模块设计

### 5.1 Hooks

```typescript
// usePersistedThread — 纯状态 hook，无网络请求
// 位置：apps/web/src/lib/hooks/use-persisted-thread.ts
interface UsePersistedThreadReturn {
  threadId: string;           // 当前活跃 threadId（'' = 未初始化）
  resetThread: () => void;    // 生成新 UUID，写入 localStorage
  switchThread: (id: string) => void;  // 切换到指定 ID
}

// useSessionList — SWR hook，获取会话摘要列表
// 位置：apps/web/src/lib/hooks/use-session-list.ts
// 模式：与 useItems / useRuns 一致
interface UseSessionListReturn {
  sessions: SessionSummary[];  // 按 created_at 降序
  loading: boolean;
  reload: () => void;          // SWR mutate
}

// useAgentSession — SWR hook，获取单个会话完整数据
// 位置：apps/web/src/lib/hooks/use-agent-session.ts
// 模式：与 useItems / useRuns 一致（SWR 自动缓存 + key-based 失效）
interface UseAgentSessionReturn {
  session: AgentSession | null;  // 完整 session（含 config_prompt, result_summary, messages）
  isLoading: boolean;
  error: Error | null;
  mutate: () => void;            // SWR mutate
}
```

`useAgentSession` 遵循项目已有的 SWR 数据获取模式，不手写缓存。SWR 自带：
- **自动缓存：** 相同 threadId 切换回来不重复请求
- **去重：** `dedupingInterval` 内相同 key 不重新请求
- **key-based 失效：** threadId 变化自动重新获取

### 5.2 模块间交互

> **📌 精修说明（Phase 3 A1 后）** — 下图保留原设计，但 `agent.setMessages()` 箭头在当前实现中不再存在：消息通过 CopilotKit `MESSAGES_SNAPSHOT` 从 checkpointer 自动恢复，不经过前端 `useEffect` 注入。图中"agent.setMessages()"节点应理解为"CopilotKit 连接 agent 后 `agent.messages` 自动可用"。

```
                    threadId (string)
                         │
          ┌──────────────┼──────────────┐
          │              │              │
          ▼              ▼              ▼
   useSessionList  CopilotKit key  useAgentSession
   (SWR 列表)     (Provider remount) (SWR 单条)
          │                             │
          │                        ┌────┴────┐
          │                        │         │
          ▼                        ▼         ▼
   SessionSidebar          agent.setMessages()
          │                (仅活跃会话,    session 对象
          │                 useEffect)   (config_prompt,
          │ 用户点击                       result_summary)
          ▼                                  │
   switchThread(id)                          ▼
          │                           SessionDetail
          └──→ threadId 变化 ──→ 循环    (根据 active/history
                                          切换渲染模式)
```

**数据单向流动：**

- `usePersistedThread` 是唯一的 threadId 写入点
- `useSessionList` 和 `useAgentSession` 只读 threadId，通过 SWR key 驱动
- 活跃会话时，`useEffect` 监听 `useAgentSession` 返回的 session data，调 `agent.setMessages()` 恢复消息
- 历史会话时，session data 直接供 SessionDetail 只读渲染

**模块间无直接调用：**

- threadId 变化 → SWR key 变化 → `useAgentSession` 自动 refetch → session 数据更新
- threadId 变化 → CopilotKit `key` 变化 → Provider remount → `useEffect` 重新执行 setMessages
- agent run 结束 → SessionDetail 监听 `isRunning` 变化 → 调 `sessionList.reload()` + `agentSession.mutate()`（1s 延迟）

### 5.3 前端缓存策略

统一使用 SWR 缓存，不手写 Map。与 `useItems` / `useRuns` 保持一致。

| 会话类型 | SWR key | 缓存行为 |
|---------|---------|---------|
| 活跃会话 | `/api/chat/sessions?thread_id={activeId}` | SWR 缓存 + CopilotKit live messages 覆盖 |
| 历史会话 | `/api/chat/sessions?thread_id={oldId}` | SWR 缓存，切换回来命中缓存不重复请求 |
| 会话列表 | `/api/chat/sessions?agent_id=radar` | SWR 缓存，手动 `mutate()` 刷新 |

SWR 配置（与现有 hooks 一致）：
```typescript
{ revalidateOnFocus: false, dedupingInterval: 2000 }
```

缓存失效：
- agent run 结束后 → `agentSession.mutate()` + `sessionList.reload()` 刷新
- NavRail 切视图 → AgentView unmount → SWR 保留缓存（下次 mount 直接用）
- D1 是 source of truth，SWR 是读取缓存层

### 5.4 为什么不放入 Zustand store

| 考虑 | 结论 |
|------|------|
| Inbox `SessionsSlice` 按 itemId 索引 | Agent 会话按 threadId 索引，数据模型不同 |
| Inbox session 需跨组件共享（InboxView ↔ ChatView ↔ MobileChatView） | Agent session 只在 AgentView 内使用，无跨组件需求 |
| store persist 会把 session 写入 localStorage | Agent 历史从 D1 加载，不需要前端持久缓存 |
| 项目已有 SWR 缓存模式 | `useItems` / `useRuns` 均用 SWR，Agent session 应保持一致 |

如果后续 Agent 会话需要在 AgentView 之外访问（如 CommandPalette 搜索历史），再迁入 store。

### 5.5 Hooks 放 `lib/hooks/`

现有所有 hooks 都在 `lib/hooks/`。新增的 3 个 hook 接口设计为通用的（`agentId` 参数化），未来其他 agent 可复用。保持一致的目录约定。

## 6. 后端变更

> **⚠️ 历史方案（已被 [`20-LANGGRAPH-PERSISTENCE.md`](./20-LANGGRAPH-PERSISTENCE.md) 替换）** — 本节的设计前提是"BFF 持久化完整消息到 D1 `chat_messages`"。Phase 2 切换到 LangGraph `AsyncSqliteSaver` 后，该前提不再成立：
>
> - §6.1 `_langchain_messages_to_dicts` 保留 tool messages —— **不再需要**：checkpointer 直接存 LangChain `BaseMessage` 对象，无格式转换
> - §6.2 `_persist_chat` 提取 config_prompt / result_summary —— **仍然适用**（这是 Phase 1 的产物，已实施）
> - §6.3 DB schema 变更 —— **已实施**（`chat_sessions` 表的 `config_prompt` / `result_summary` 字段已存在）
> - §6.4 `POST /api/chat/persist` 扩展 body —— **部分适用**：`messages` 字段已从 payload 中移除（commit 9b2069b），只保留 `config_prompt` / `result_summary`；`GET /api/chat/sessions` 响应不再返回 `messages` 数组
>
> 以下内容保留作为历史方案记录，精修时未删除。

### 6.1 Python：`_langchain_messages_to_dicts` 保留 tool messages

当前（`agui_tracing.py:36-65`）过滤逻辑：

```python
# 当前：只保留 user/assistant 且 content 非空
if role not in ("user", "assistant", "tool", "system"):
    continue
content = getattr(msg, "content", "")
if not content:
    continue
```

问题：assistant 消息如果只有 `tool_calls` 没有 `content`，会被过滤掉。tool 消息的 content 是 tool 执行结果，保留了但前端之前不用。

改动：
1. assistant 消息：即使 `content` 为空，只要有 `tool_calls` 也保留
2. tool 消息：保留，并附带 `tool_call_id`
3. 保持过滤 system 消息

### 6.2 Python：`_persist_chat` 统一写入 config_prompt 和 result_summary

**单一写入方：** `_persist_chat` 是 session 数据的唯一写入入口，前端只读。

在 `_persist_chat` 中新增两步提取：

**config_prompt 提取：**
`useAgentContext` 注入的用户偏好会出现在 LangGraph state 的 messages 中（CopilotKit 将其编码为 system message）。`_persist_chat` 从 state messages 中查找包含配置内容的 system message，提取其 content 作为 `config_prompt`。

提取逻辑封装为 `_extract_config_prompt(messages)` 函数，与 CopilotKit 的编码格式解耦：按 role=system 且包含特定标记（如"推荐偏好"或"核心使命"）匹配。如果 CopilotKit 编码格式变化，只改这一个函数。

**result_summary 提取：**
从 messages 中查找 evaluate tool call 的结果（role=tool 且对应 tool_call name=evaluate），解析 JSON 提取 `{ evaluated, promoted, rejected }`。

提取逻辑封装为 `_extract_result_summary(messages)` 函数。

两个字段通过 `PlatformClient.persist_chat()` 的 payload 一并发送给 BFF。

### 6.3 DB Schema 变更

`chat_sessions` 表新增两个字段：

```sql
ALTER TABLE chat_sessions ADD COLUMN config_prompt TEXT;
ALTER TABLE chat_sessions ADD COLUMN result_summary TEXT;  -- JSON string
```

### 6.4 API 变更

**`POST /api/chat/persist`** — 扩展 body：

```typescript
// 新增可选字段
const persistBodySchema = z.object({
  agent_id: z.string().min(1),
  thread_id: z.string().min(1),
  messages: z.array(messageSchema).min(1),
  config_prompt: z.string().optional(),           // 新增
  result_summary: z.object({                      // 新增
    evaluated: z.number(),
    promoted: z.number(),
    rejected: z.number(),
  }).optional(),
});
```

**`GET /api/chat/sessions?agent_id=xxx`** — 返回值扩展：

```typescript
interface SessionSummary {
  id: string;
  agent_id: string;
  created_at: string;
  message_count: number;
  preview: string;
  config_prompt: string | null;     // 新增
  result_summary: { ... } | null;   // 新增
}
```

**`GET /api/chat/sessions?thread_id=xxx`** — 返回值扩展：

```typescript
interface SessionHistory {
  session_id: string;
  messages: PersistedMessage[];     // 现在包含 tool messages
  config_prompt: string | null;     // 新增
  result_summary: { ... } | null;   // 新增
}
```

## 7. 数据流转

### 7.1 threadId 生命周期

```
首次访问
  └─ usePersistedThread
       ├─ useState('') — SSR 安全初始值
       └─ useEffect
            ├─ localStorage.getItem('agent-lab.radar.threadId')
            ├─ 无值 → crypto.randomUUID() → localStorage.setItem → setThreadId
            └─ 有值 → setThreadId(stored)

刷新页面
  └─ 同上，useEffect 读取已有值

新会话
  └─ resetThread()
       ├─ crypto.randomUUID() → localStorage.setItem → setThreadId(newId)
       └─ CopilotKit key 变化 → Provider remount → 空白活跃会话

切换到历史会话
  └─ switchThread(oldId)
       ├─ localStorage.setItem → setThreadId(oldId)
       └─ CopilotKit remount → useHistoryLoader 加载 → 只读模式
```

### 7.2 消息持久化时序（Phase 3 A1 后）

> **📌 更新** — 消息由 checkpointer 在每个 graph step 自动落盘，与 `_persist_chat` 解耦。`_persist_chat` 的 payload 不再携带 `messages`，`/api/chat/persist` 内部只走 `ensureSession + updateSessionMetadata`，不再调用 `insertMessage`。

```
用户发消息 → CopilotChat → BFF SSE 透传 → Python Agent
  → LangGraph graph 每个 step 结束
     → AsyncSqliteSaver.aput(checkpoint) → agents/radar/data/checkpoints.db（自动、持续）
  → LangGraph run 完成
  → TracingLangGraphAGUIAgent.run() yield 完毕
  → asyncio.create_task(_persist_chat(thread_id))
     → graph.aget_state() 取全部 messages
     → _extract_config_prompt(messages)              ← 从 system message 提取配置快照
     → _extract_result_summary(messages)             ← 从 evaluate tool result 提取摘要
     → PlatformClient.persist_chat()
        → POST /api/chat/persist {
            agent_id, thread_id,
            config_prompt?,                          ← Python 提取，单一写入方
            result_summary?                          ← Python 提取，单一写入方
            （不再发 messages）
          }
        → ensureSession + updateSessionMetadata → D1 chat_sessions（仅元数据）
```

### 7.3 历史会话加载时序（Phase 3 A1 后）

> **📌 更新** — 消息恢复从"前端 `agent.setMessages()` 注入"改为"CopilotKit 连接 agent 时自动收 `MESSAGES_SNAPSHOT`"。SWR 只负责元数据，与消息恢复解耦。

```
threadId 变化（切换会话 / 刷新页面）
  → SWR key 变化: /api/chat/sessions?thread_id={newThreadId}
  → useAgentSession 自动 refetch（或命中 SWR 缓存）
  → 响应: { session_id, config_prompt, result_summary }   ← 不再含 messages

同时，CopilotKit Provider remount（key={threadId}）
  → useAgent 内部连接 agent server
  → 后端 checkpointer 按 thread_id 回放 checkpoint
  → 前端收到 MESSAGES_SNAPSHOT 事件 → agent.messages 自动填充

  SessionDetail 根据 isActiveSession 条件渲染：
     活跃会话（threadId === usePersistedThread().threadId）：
       → CopilotKit 自动连接（useAgent 默认行为）
       → 渲染可编辑 ConfigCards + CopilotChat + preset
       → trace 从 agent.messages 实时构建

     历史会话（只读）：
       → 手动调 connectAgent(threadId) 触发 checkpointer 恢复
       → session 元数据直接供只读渲染（ConfigSnapshot + ResultsPane）
       → 消息列表只读渲染 agent.messages
       → trace 从 agent.messages 构建（与活跃同源）
```

### 7.4 会话列表刷新时序

| 时机 | 触发方式 | 说明 |
|------|---------|------|
| AgentView mount | SWR 自动 | 初始加载 |
| agent run 结束 | `isRunning` true→false + 1s 延迟 → `reload()` | Python 持久化是异步的 |
| 新建会话后首次发消息结束 | 同上 | 新 session 被 persist 后才出现在列表 |

## 8. 依赖关系与约束

### 8.1 CopilotKit Provider remount

```
<CopilotKit key={threadId}>  ← key 变化 = 整个 subtree unmount + remount
  <SessionDetail />
</CopilotKit>
```

结果：`useAgent` 返回全新 agent 实例，`CopilotChat` 重建，所有 `useEffect` 重新执行。

**约束 1：`usePersistedThread` 必须在 CopilotKit 外层。** 否则 remount 丢失 threadId state。

**约束 2：`useAgentSession` 放哪层都行（SWR hook 不依赖 Provider）。** ~~消息恢复的 `useEffect`（调 `agent.setMessages()`）必须在 CopilotKit 内层~~ — Phase 3 A1 后此约束已不再需要：消息由 CopilotKit 连接后通过 `MESSAGES_SNAPSHOT` 自动恢复，无须前端 `setMessages()` 注入。只需读取 `agent.messages` 的组件放 Provider 内即可。

**约束 3：`SessionSidebar` 放外层。** 不依赖 CopilotKit，避免 remount 时列表重渲染和闪烁。

**约束 4：`useSessionList` 放外层。** 列表数据不随 threadId 变化，避免不必要的重请求。

### 8.2 Inspector workaround（✅ 已删除）

> **✅ 已解决** — CopilotKit 升级到 1.56.2 后，Inspector 的 thread clone bug 被官方修复，DOM bridge workaround 已从代码库删除（对应 commit 7154ba6 还原 + 后续清理）。原描述保留：

当前 DOM bridge（`AgentView.tsx:222-233`）通过 `subscribeToAgent(agent)` 订阅 Inspector。threadId 来源变了但传递路径不变。**无影响。** 待 CopilotKit 升级后统一删除。

### 8.3 useAgentContext 与 ConfigCards

`useAgentContext` 注入用户偏好到 agent 上下文。Provider remount 后 `configVersion` 重置为 0，但 `buildPromptFromCards()` 从 localStorage 读配置，仍能正确生成。**无影响。**

### 8.4 后端 persist 的"全量覆盖"（✅ 已消失）

> **✅ 已解决（Phase 2 顺带）** — 切换到 LangGraph checkpointer 后，消息不再经过 `_persist_chat` → `insertMessage` 追加路径。checkpointer 按 `thread_id + checkpoint_id` 幂等写入，天然无重复。前端去重逻辑也可下线。以下描述保留作为历史记录：

`_persist_chat` 每次发全部消息给 `/api/chat/persist`，`insertMessage` 追加。多轮对话后 DB 有重复行。

**对 trace 重建的影响：** 重复的 tool messages 会在 `buildTraceFromMessages` 中产生重复 spans。需要在加载后去重（按 role + content 或 tool_call_id 去重）。

**本期处理：** 前端加载后去重。后续若需要，Python 端改为增量 persist。

## 9. 边界条件

### 9.1 SSR / Hydration

- `usePersistedThread` 初始值空字符串，`useEffect` 中读 localStorage
- `threadId === ''` 时条件渲染，不挂载 CopilotKit → 避免 hydration mismatch
- 首帧短暂空白 → 可接受，Agent 视图无 SEO 需求

### 9.2 空会话

- 新建会话但未发消息 → localStorage 有 threadId，后端无 session
- 刷新 → API 返回空 → 正常空 chat
- 会话列表不显示（后端过滤 `message_count === 0`）

### 9.3 历史消息格式兼容（⚠️ 不再适用 — Phase 2 后）

> **⚠️ 已过时** — checkpointer 直接存 LangChain `BaseMessage` 对象（pickle 序列化到 SQLite），不需要跨格式转换；CopilotKit 的 `MESSAGES_SNAPSHOT` 事件直接消费这些对象。本节描述的"D1 JSON → CopilotKit `setMessages()` 过滤"流程已被 checkpointer 自动回放取代。保留以记录历史设计。

DB 存储格式（Python 写入，改后）：
```json
{ "role": "user|assistant|tool", "content": "...", "tool_calls": [...], "tool_call_id": "..." }
```

CopilotKit `agent.setMessages()` 期望：
```json
{ "id": "...", "role": "user|assistant", "content": "..." }
```

活跃会话加载时：
- 过滤为 `role ∈ {user, assistant}` 且 `content` 非空 → 传给 `setMessages()`
- tool messages 不传给 CopilotKit，但保留在 session 对象中供 trace 重建

历史会话（只读）：
- 全部消息直接用于 `buildTraceFromMessages()` 重建 trace
- user/assistant 文本用 MessageList 只读渲染

### 9.4 Python 持久化延迟

`_persist_chat` 是 fire-and-forget。agent run 结束后到 D1 写入之间有延迟。

会话列表 reload 加 1s 延迟兜底。

### 9.5 config_prompt 提取的 CopilotKit 耦合

`config_prompt` 由 Python 从 LangGraph state 的 system message 中提取（§6.2）。CopilotKit `useAgentContext` 将前端注入的 value 编码为 system message，其具体格式由 CopilotKit 控制。

**耦合风险：** CopilotKit 升级可能改变 system message 的编码方式。

**隔离措施：** 提取逻辑封装在 `_extract_config_prompt(messages)` 函数中，通过内容特征匹配（检查是否包含 ConfigCards 的标志性关键词如"核心使命""推荐偏好"），不依赖 CopilotKit 的结构化格式。升级时只需调整这一个函数。

**降级：** 如果提取失败（格式变化未被捕获），`config_prompt` 为 null，前端展示"配置快照不可用"。不影响其他功能。

## 10. 局限性

| 局限 | 影响 | 是否阻塞 |
|------|------|---------|
| **persist 全量覆盖产生重复** | 历史加载需前端去重 | 否 — 前端去重 |
| **会话列表无分页** | 超 20 个会话后看不到更早的 | 否 — 单用户 |
| **threadId 绑定单设备** | localStorage 不跨设备 | 否 — 可通过列表切换 |
| **CopilotKit remount 闪烁** | 切换会话有短暂空白 | 否 — 架构约束 |
| **历史会话不可续写** | 产品决策，不是技术限制 | 否 — 明确不做 |
| **config_prompt 是快照文本** | 不能结构化对比两次配置差异 | 否 — 满足"看看当时怎么配的"需求 |
| **reload 靠 1s 延迟** | 网络慢时可能取不到 | 否 — 刷新可兜底 |

### CopilotKit 架构约束

- `useAgent` 必须在 Provider 内
- 切换 thread 只能通过 `key` remount
- ~~历史加载只能在 mount 后通过 `agent.setMessages()` 注入~~ — Phase 3 A1 后改为 mount 后由 CopilotKit 自动发 `MESSAGES_SNAPSHOT`（checkpointer 回放），历史模式下前端手动调 `connectAgent(threadId)` 触发
- 如果 CopilotKit 未来提供 `switchThread()` API，可消除 remount 开销

### Inbox 与 Agent 会话双轨制

两套会话体系（itemId vs threadId）独立，无关联。如果未来需要"从 Inbox 跳转到生成该 item 的 agent 会话"，需在 items 表增加 `agent_thread_id` 字段。这是下期"对话工作台"的范畴。

## 11. 后续演进

### → 对话工作台（下期）

Chat 成为主入口后：
- 会话列表重要性上升，可能需要搜索
- 会话可能需要写入 Zustand store（CommandPalette 搜索）
- hooks 接口保持不变，store 作为上层聚合

### → 多 Agent 扩展

`usePersistedThread` localStorage key 改为 `agent-lab.{agentId}.threadId`，hook 接受 agentId 参数。`useSessionList` 已参数化。

### → CopilotKit 升级

PR #3872 合并后删除 Inspector workaround。可能获得更好的 thread 管理 API。

### → 持久化去重（✅ 已不再适用）

> **✅ 已由 Phase 2 消除** — 切换到 checkpointer 后天然无重复，不再需要增量 persist / upsert。

Python 端改为增量 persist（维护 `last_persisted_index`），或后端 `insertMessage` 加 upsert。

## 12. 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| **前端** | | |
| `apps/web/src/lib/hooks/use-persisted-thread.ts` | 新增 | threadId 持久化 hook |
| `apps/web/src/lib/hooks/use-session-list.ts` | 新增 | 会话列表 SWR hook |
| `apps/web/src/lib/hooks/use-agent-session.ts` | 新增 | 单条会话 SWR hook（与 useItems/useRuns 一致） |
| `apps/web/src/app/agents/radar/components/production/SessionSidebar.tsx` | 新增 | 会话列表独立组件 |
| `apps/web/src/app/agents/radar/components/production/SessionDetail.tsx` | 新增 | 会话详情（活跃/只读双模式） |
| `apps/web/src/app/agents/radar/components/production/ConfigSnapshot.tsx` | 新增 | 配置快照只读展示 |
| `apps/web/src/app/agents/radar/components/production/AgentView.tsx` | 重构 | 瘦身为组装层（Provider + hooks + 子组件组合） |
| **后端** | | |
| `agents/radar/src/radar/agui_tracing.py` | 修改 | `_langchain_messages_to_dicts` 保留 tool messages + tool_calls |
| `agents/radar/src/radar/agui_tracing.py` | 修改 | `_persist_chat` 附带 config_prompt + result_summary |
| `apps/web/src/app/api/chat/persist/route.ts` | 修改 | 接受 config_prompt / result_summary 可选字段 |
| `apps/web/src/app/api/chat/sessions/route.ts` | 修改 | 返回 config_prompt / result_summary |
| `apps/web/src/lib/chat.ts` | 修改 | `listAgentSessions` / `getSessionByThreadId` 返回新字段 |
| `apps/web/src/lib/db/schema.ts` | 修改 | `chat_sessions` 表新增 config_prompt / result_summary 字段 |
| `apps/web/migrations/` | 新增 | ALTER TABLE 迁移 |

## 13. 不做的事

- **不做历史会话续写** — 配置已变，续写产生混乱
- **不做配置回滚** — 快照只读参考
- **不做对话搜索/分类** — 效率至上，不增管理负担
- **不做会话导出/分享** — 单用户产品
- **不做跨设备同步** — localStorage 不跨设备
- **不做持久化去重** — 前端临时去重
- **不做会话分页** — 20 条上限
