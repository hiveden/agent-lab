# CopilotKit 事件流架构

## 1. 完整事件流路径

```
                            SSE (text/event-stream)
                           ┌─────────────────────────┐
  ┌──────────┐   POST      │    ┌───────────────┐     │    POST       ┌──────────────┐
  │ Browser  │────────────>│    │  CopilotKit    │     │──────────────>│ Python Agent │
  │          │             │    │  Runtime       │     │               │ (FastAPI)    │
  │ ┌──────┐ │   SSE       │    │  (passthrough) │     │    SSE        │              │
  │ │ Chat │<│<────────────│<───│               │<────│<──────────────│ LangGraph    │
  │ └──────┘ │             │    └───────────────┘     │               │ + Tracing    │
  │          │             │                          │               └──────────────┘
  │ ┌──────┐ │             │    Next.js BFF           │
  │ │ Dev  │ │             │    :8788                  │               :8001
  │ │Console│ │             └─────────────────────────┘
  │ └──────┘ │
  └──────────┘
```

### 请求完整链路（用户发送消息）

```
User Input
  │
  ▼
CopilotChat.onSend()
  │  agent.addMessage({ role:'user', content:'...' })
  │  agent.runAgent()
  │
  ▼
POST /api/agent/chat  ─────────────────────────────────> POST /agent/chat
  │  CopilotRuntime → LangGraphHttpAgent                   │
  │  (SSE passthrough, 不做任何处理)                         ▼
  │                                              TracingLangGraphAGUIAgent.run()
  │                                                │
  │                                                ├── graph.astream_events()
  │                                                │     LangChain 内部事件
  │                                                │
  │                                                ├── _dispatch_event() 去重
  │                                                │     Layer 1: 重复 START 过滤
  │                                                │     Layer 2: 孤立 END 过滤
  │                                                │     Layer 3: 连续 CONTENT 去重
  │                                                │
  │                                    SSE         ▼
  │<───────────────────────────────────────── yield event
  │
  ▼
Browser EventSource 接收
  │
  ▼
AbstractAgent (thread clone) 处理事件
  │
  ├──> agent.messages 更新 ──> CopilotChat 重新渲染
  ├──> agent.state 更新   ──> useAgent() hook 触发
  └──> subscriber 回调    ──> Inspector 记录事件 (如果已订阅)
```

## 2. AG-UI 事件类型

### 生命周期事件
| 事件 | 说明 | 频率 |
|------|------|------|
| `RUN_STARTED` | 交互开始，携带 thread_id, run_id | 1/次 |
| `RUN_FINISHED` | 交互完成 | 1/次 |
| `RUN_ERROR` | 交互失败 | 0-1/次 |

### 消息事件
| 事件 | 说明 | 频率 |
|------|------|------|
| `TEXT_MESSAGE_START` | 消息开始，携带 message_id, role | 1/消息 |
| `TEXT_MESSAGE_CONTENT` | **最频繁**，每 token 一个 | ~50/消息 |
| `TEXT_MESSAGE_END` | 消息结束 | 1/消息 |

### Tool 事件
| 事件 | 说明 | 频率 |
|------|------|------|
| `TOOL_CALL_START` | Agent 决定调用工具 | 1/调用 |
| `TOOL_CALL_ARGS` | 工具参数（可流式） | 1+/调用 |
| `TOOL_CALL_END` | 工具调用结束 | 1/调用 |
| `TOOL_CALL_RESULT` | 工具执行结果 | 1/调用 |

### 状态事件
| 事件 | 说明 | 频率 |
|------|------|------|
| `STATE_SNAPSHOT` | LangGraph node 结束时全量状态 | 2-4/次 |
| `STATE_DELTA` | 增量状态更新 | 按需 |
| `RAW` | LangChain 内部透传事件 | ~100+/次 |

### 典型 50 token 回复的事件量

```
RUN_STARTED + RUN_FINISHED        2
TEXT_MESSAGE_START + END           2
TEXT_MESSAGE_CONTENT              ~50    (每 token 一个)
STATE_SNAPSHOT                   2-4
RAW (LangChain 内部事件)         ~100+   (最多)
────────────────────────────────────
总计                             ~200 events
```

## 3. Thread Clone vs Registry Agent

这是理解 Dev Console bug 的核心。

```
CopilotKit Provider
  │
  ├── agents registry (core.agents)
  │     │
  │     └── "radar" ─────────────── Registry Agent (单例)
  │                                   │  聚合所有 thread 的状态
  │                                   │  Inspector 默认订阅这个
  │                                   │  但它不收到具体 thread 的事件
  │
  └── useAgent({ agentId:'radar', threadId:'abc' })
        │
        └── globalThreadCloneMap ──── Thread Clone (per threadId)
              WeakMap<Agent, Map>        │  隔离的消息和状态
                                         │  CopilotChat 用这个
                                         │  实际的 SSE 事件流向这里
                                         │  Inspector 默认不订阅这个
```

### Clone 创建流程

```typescript
// @copilotkit/react-core/v2/hooks/use-agent.tsx

// 模块级 WeakMap：registryAgent → (threadId → clone)
const globalThreadCloneMap = new WeakMap<AbstractAgent, Map<string, AbstractAgent>>();

function getOrCreateThreadClone(existing, threadId, headers) {
  let byThread = globalThreadCloneMap.get(existing);
  if (!byThread) { byThread = new Map(); globalThreadCloneMap.set(existing, byThread); }
  const cached = byThread.get(threadId);
  if (cached) return cached;

  const clone = existing.clone();
  clone.threadId = threadId;
  clone.setMessages([]);   // 空消息
  clone.setState({});      // 空状态
  byThread.set(threadId, clone);
  return clone;
}
```

## 4. Dev Console (Inspector) 事件订阅

### Inspector 如何订阅 Agent

```typescript
// @copilotkit/web-inspector/src/index.ts

// Inspector 内部的订阅方法
private subscribeToAgent(agent: AbstractAgent): void {
  const subscriber = {
    onRunStartedEvent:          (e) => this.recordAgentEvent(agentId, "RUN_STARTED", e),
    onTextMessageContentEvent:  (e) => this.recordAgentEvent(agentId, "TEXT_MESSAGE_CONTENT", e),
    onToolCallStartEvent:       (e) => this.recordAgentEvent(agentId, "TOOL_CALL_START", e),
    // ... 所有事件类型
  };
  const unsubscribe = agent.subscribe(subscriber);  // 底层 ag-ui/client API
  this.agentSubscriptions.set(agentId, unsubscribe);
}
```

### v1.55.3 的 Bug

```typescript
// Inspector 的 processAgentsChanged() 只遍历 registry
for (const agent of Object.values(agents)) {  // agents = core.agents registry
  this.subscribeToAgent(agent);  // 订阅 Registry Agent
}
// Thread Clone 不在 registry 中 → Inspector 永远不会自动订阅到 Clone
```

### 事件流断裂图

```
SSE events ──> Thread Clone ──> CopilotChat ✅ 正常渲染
                    │
                    │  (Inspector 没订阅 Clone)
                    │
              Registry Agent ──> Inspector ❌ 0 events
                    │
                    └── 没有事件流入，因为事件只发给 Clone
```

### Bridge Workaround

```typescript
// SessionDetail.tsx 中的临时方案
useEffect(() => {
  if (!agent?.agentId) return;           // agent = thread clone (from useAgent)
  let attempts = 0;
  const trySubscribe = () => {
    const el = document.querySelector('cpk-web-inspector');
    if (el?.subscribeToAgent) {
      el.subscribeToAgent(agent);        // 手动把 Clone 塞给 Inspector
      return;
    }
    if (++attempts < 20) setTimeout(trySubscribe, 200);  // 轮询 4 秒
  };
  trySubscribe();
}, [agent]);
```

## 5. key={threadId} 导致的问题

```
Session A (threadId="aaa")        Session B (threadId="bbb")
─────────────────────────        ─────────────────────────
<CopilotKit key="aaa">          <CopilotKit key="bbb">
  Inspector ✅ 已订阅               Inspector ❓ 新实例
  Clone "aaa" ✅ 活跃               Clone "bbb" ✅ 活跃
  Bridge ✅ 已连接                   Bridge ❓ 需重新轮询
</CopilotKit>                    </CopilotKit>

              切换 session
         key 变化 → 整棵树 unmount + remount
         ─────────────────────────────────>

         Inspector DOM 元素被销毁重建
         Bridge useEffect 重新执行
         但 Inspector web component 可能还没初始化完
         → subscribeToAgent 找不到方法 → 轮询超时 → ❌
```

### 时序竞态

```
t=0ms    CopilotKit remount (key change)
t=0ms    旧 Inspector DOM 销毁
t=10ms   SessionDetail mount
t=10ms   useAgent() 返回新 clone
t=10ms   Bridge useEffect 开始轮询
t=50ms   新 Inspector DOM 插入（但 web component 未初始化）
t=200ms  Bridge: el 存在但 subscribeToAgent === undefined → 继续轮询
t=400ms  Bridge: 同上
...
t=800ms  Inspector web component 初始化完成，subscribeToAgent 可用
t=800ms  Bridge: ✅ 订阅成功
```

正常情况下 4 秒内能订阅成功。但如果 Inspector 加载异常慢或初始化失败，bridge 超时。

## 6. 去重策略（Python 端）

```
LangChain astream_events()
  │
  │  产生重复事件（Ollama/DeferredLLM 的 artifact）
  │
  ▼
TracingLangGraphAGUIAgent._dispatch_event()
  │
  ├── Layer 1: START 配对
  │     同一 ID 的 TEXT_MESSAGE_START 只允许一次
  │     重复 → suppress + warning log
  │
  ├── Layer 2: 孤立 END
  │     没有匹配 START 的 END → suppress
  │     (Layer 1 吞掉 START 后对应的 END 就成了孤立)
  │
  ├── Layer 3: CONTENT 连续去重
  │     DeferredLLM → ChatOpenAI 各发一次相同 delta
  │     连续两个 (message_id, delta) 相同 → 丢弃第二个
  │
  ▼
干净的事件流 → SSE → 前端
```

## 7. 持久化流程（非阻塞）

```
SSE 流完成 (所有 event yield 完毕)
  │
  ▼
asyncio.create_task(_persist_chat(thread_id))   ← fire-and-forget
  │
  ├── graph.aget_state() 获取最终状态
  ├── _langchain_messages_to_dicts() 序列化消息
  ├── _extract_config_prompt() 提取用户配置
  ├── _extract_result_summary() 提取评判结果
  │
  ▼
PlatformClient.persist_chat()
  │  POST /api/chat/persist (Bearer auth)
  │  body: { agent_id, thread_id, messages, config_prompt?, result_summary? }
  │
  ▼
BFF: ensureSession() + insertMessage() + updateSessionMetadata()
  │  写入 D1 (SQLite)
  │
  ▼
完成（失败只 log，不影响用户）
```

## 8. 当前架构问题：SessionDetail 与 CopilotKit 耦合

### 现状（有 bug）

```
AgentView
  ├── SessionSidebar
  └── <CopilotKit key={threadId}>          ← 切换 session 时整棵树 remount
        └── <SessionDetail>
              ├── useAgent(threadId)        ← 历史 session 也会创建 clone 并连后端
              ├── useAgentContext()         ← 历史 session 也注册偏好
              ├── Bridge useEffect          ← 历史 session 也尝试订阅 Inspector
              ├── isActive → CopilotChat   ← 实时对话
              └── !isActive → 只读列表     ← 虽然只读，但外层 hooks 全在跑
```

**问题链**：
1. `key={threadId}` 是为了切换 session 时清理 CopilotKit 状态
2. 但 `key` 变化 = 整棵树 unmount + remount = Inspector 被销毁重建
3. Inspector web component 重建后初始化有延迟，bridge 轮询订阅时序不确定
4. 结果：Dev Console 和 Chat 不同步，需要刷新页面才能看到数据

**根因**：历史只读视图不应该在 CopilotKit 内部，但 SessionDetail 同时承担了活跃对话和历史展示两个职责。

### 目标架构

```
AgentView
  ├── SessionSidebar
  │
  ├── 活跃 session ──────────────────────────────
  │   └── <CopilotKit showDevConsole>     ← 单例挂载，永不 remount
  │         └── <ActiveSession>
  │               ├── useAgent(threadId)  ← 唯一活跃 clone
  │               ├── useAgentContext()
  │               ├── Bridge useEffect    ← 订阅一次，持续有效
  │               ├── CopilotChat         ← 实时对话
  │               └── Inspector           ← 实时事件同步 ✅
  │
  └── 历史 session ──────────────────────────────
      └── <HistoryView>                   ← 纯 React，无 CopilotKit
            ├── 从 API 读持久化消息
            ├── 只读消息列表
            ├── ConfigSnapshot（配置快照）
            └── Trace（从持久化数据构建）
```

**关键变化**：
- CopilotKit 只为活跃 session 挂载，**没有 `key` prop**，永不 remount
- Inspector bridge 订阅一次，生命周期内持续有效
- 历史 session 完全在 CopilotKit 外部渲染，不触发任何 agent 连接
- SessionDetail 拆成 `ActiveSession`（CopilotKit 内）和 `HistoryView`（CopilotKit 外）

### 设计原则

| 原则 | 说明 |
|------|------|
| CopilotKit 单例 | 一个页面只有一个 CopilotKit 实例，不用 `key` 触发 remount |
| 活跃 session 独占 CopilotKit | 只有当前正在对话的 session 走 CopilotKit 事件流 |
| 历史只读 | 历史 session 从 D1 读取持久化数据，纯展示，不创建 agent clone |
| Inspector 稳定订阅 | Bridge 在 CopilotKit 首次挂载时订阅，整个生命周期有效 |

## 9. 已知限制

| 限制 | 原因 | 解决方案 |
|------|------|----------|
| Inspector 不自动订阅 thread clone | CopilotKit v1.55.3 bug | Bridge workaround / 等 PR #3872 |
| RAW 事件量大 (~100+/次) | ag-ui-langgraph 无条件透传 | 仅调试用，生产可忽略 |
| DeferredLLM 双倍 CONTENT 事件 | 包装层 artifact | Python 端 Layer 3 去重 |
