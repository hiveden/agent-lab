# AG-UI 事件协议详解

> 一条 Chat 消息为什么产生 200 个事件？本文解释 AG-UI 事件协议的完整结构。

## AG-UI 是什么

AG-UI（Agent-UI Protocol）是 Agent 与前端之间的**流式通信协议**。它把一次 Agent 交互拆成细粒度事件，通过 SSE（Server-Sent Events）逐个推送给前端。

类比：HTTP 是请求-响应模型（发一个请求，等完整响应）。AG-UI 是事件流模型（发一个请求，收到一连串事件，实时渲染）。

## 一条消息的事件生命周期

用户发"帮我搜索 WebGPU"，Agent 回复一段文字并调用了一个 tool：

```
RUN_STARTED                          ← 整次交互开始
│
├─ TEXT_MESSAGE_START                ← 开始一条助手消息
│  ├─ TEXT_MESSAGE_CONTENT "好的"    ← 流式文本 chunk
│  ├─ TEXT_MESSAGE_CONTENT "，我来"
│  ├─ TEXT_MESSAGE_CONTENT "帮你"
│  ├─ TEXT_MESSAGE_CONTENT "搜索"
│  └─ ...（每个 streaming token 一个事件）
├─ TEXT_MESSAGE_END                  ← 该条消息结束
│
├─ TOOL_CALL_START                   ← Agent 决定调用 web_search tool
│  ├─ TOOL_CALL_ARGS                 ← tool 参数（流式/一次性）
│  └─ TOOL_CALL_END                  ← tool 调用结束
├─ TOOL_CALL_RESULT                  ← tool 执行结果返回
│
├─ TEXT_MESSAGE_START                ← Agent 根据 tool 结果生成回复
│  ├─ TEXT_MESSAGE_CONTENT "根据"
│  ├─ TEXT_MESSAGE_CONTENT "搜索"
│  ├─ TEXT_MESSAGE_CONTENT "结果"
│  ├─ ...（又是几十个 content 事件）
│  └─ TEXT_MESSAGE_END
│
├─ STATE_SNAPSHOT                    ← LangGraph 状态快照
│
├─ RAW (on_chain_start)              ← LangChain 原始事件（透传）
├─ RAW (on_chat_model_stream)
├─ RAW (on_chain_end)
├─ ...（每个 LangChain 内部事件都有 RAW）
│
└─ RUN_FINISHED                      ← 整次交互结束
```

## 事件类型全表

### 核心事件（前端消费）

| 类型 | 作用 | 频率 |
|------|------|------|
| `RUN_STARTED` | 标记交互开始，携带 thread_id, run_id | 每次交互 1 个 |
| `RUN_FINISHED` | 标记交互结束 | 每次交互 1 个 |
| `RUN_ERROR` | 交互出错 | 出错时 1 个 |
| `TEXT_MESSAGE_START` | 开始一条文本消息，携带 message_id, role | 每条消息 1 个 |
| `TEXT_MESSAGE_CONTENT` | 文本增量（delta），流式 token | **每个 token 1 个**，是数量最多的事件 |
| `TEXT_MESSAGE_END` | 文本消息结束 | 每条消息 1 个 |
| `TOOL_CALL_START` | Agent 发起 tool 调用，携带 tool_call_id, tool name | 每次 tool 调用 1 个 |
| `TOOL_CALL_ARGS` | tool 参数（可流式） | 1-N 个 |
| `TOOL_CALL_END` | tool 调用结束 | 每次 tool 调用 1 个 |
| `TOOL_CALL_RESULT` | tool 执行结果 | 每次 tool 调用 1 个 |
| `STATE_SNAPSHOT` | Agent 完整状态快照 | 状态变化时 |
| `STATE_DELTA` | Agent 状态增量更新 | 状态变化时 |
| `MESSAGES_SNAPSHOT` | 完整消息列表快照 | 不常用 |

### 辅助事件

| 类型 | 作用 | 频率 |
|------|------|------|
| `RAW` | LangChain 原始事件透传（debug 用） | **每个 LangChain 事件 1 个** |
| `CUSTOM` | 自定义事件（如 LangGraph interrupt） | 按需 |
| `REASONING_START/CONTENT/END` | 思考过程（如 Claude thinking） | 支持 reasoning 的模型 |

## 为什么 200 个事件

以一条普通回复（约 50 个 streaming token）为例：

| 事件类型 | 数量 | 说明 |
|---------|------|------|
| RUN_STARTED + RUN_FINISHED | 2 | 一头一尾 |
| TEXT_MESSAGE_START + END | 2 | 一条消息的边界 |
| TEXT_MESSAGE_CONTENT | ~50 | 每个 token 一个 |
| STATE_SNAPSHOT | ~2-4 | LangGraph 节点切换时 |
| RAW | ~100+ | **最大头** |

### RAW 事件为什么这么多

`ag-ui-langgraph` adapter 对 LangGraph `astream_events` 产生的**每一个** LangChain 事件都生成一个 RAW 事件：

```python
# ag-ui-langgraph 内部（_handle_stream_events）
async for event in stream:
    # 1. 无条件发 RAW
    yield self._dispatch_event(RawEvent(type=EventType.RAW, event=event))

    # 2. 再处理成具体 AG-UI 事件
    async for single_event in self._handle_single_event(event, state):
        yield single_event
```

LangChain 一次 LLM 调用产生的内部事件：

```
on_chain_start (LangGraph 开始)
  on_chain_start (agent node 开始)
    on_llm_start (ChatOpenAI 开始)
      on_chat_model_stream (token 1)    → RAW + TEXT_MESSAGE_CONTENT
      on_chat_model_stream (token 2)    → RAW + TEXT_MESSAGE_CONTENT
      ...
      on_chat_model_stream (token 50)   → RAW + TEXT_MESSAGE_CONTENT
    on_llm_end (ChatOpenAI 结束)
  on_chain_end (agent node 结束)
on_chain_end (LangGraph 结束)
```

每个 `on_chat_model_stream` 产生 2 个 AG-UI 事件（RAW + TEXT_MESSAGE_CONTENT），50 个 token = 100 个事件。加上 chain start/end 等 = ~120。加上 tool 调用（如果有）还会翻倍。

## 事件流的物理传输

```
Python Agent Server
  → LangGraph astream_events (LangChain 事件)
  → ag-ui-langgraph adapter (转换为 AG-UI 事件)
  → TracingLangGraphAGUIAgent._dispatch_event (去重)
  → SSE stream (text/event-stream)
  → Next.js BFF (透传)
  → CopilotKit Runtime (透传)
  → 浏览器 EventSource
  → CopilotKit react-core (AbstractAgent 处理)
  → useAgent subscribers + Inspector
```

每个事件在 SSE 中是一行 JSON：

```
data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"lc_run--xxx","delta":"你好"}

data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"lc_run--xxx","delta":"，我来"}

data: {"type":"RAW","event":{"event":"on_chat_model_stream","data":{...}}}
```

## 前端如何消费

CopilotKit 的 `AbstractAgent` 内部处理事件流，对外暴露高层 API：

| AG-UI 事件 | AbstractAgent 行为 | React 侧可见 |
|-----------|-------------------|-------------|
| TEXT_MESSAGE_CONTENT | 追加到 message.content | `agent.messages` 更新 |
| TEXT_MESSAGE_START/END | 创建/封闭 message 对象 | `agent.messages` 数组长度变化 |
| TOOL_CALL_* | 追踪 tool 调用状态 | `toolCallsView` slot 渲染 |
| STATE_SNAPSHOT | 更新 agent.state | `agent.state` 更新 |
| RUN_STARTED/FINISHED | 切换运行状态 | `agent.isRunning` 变化 |
| RAW | 不处理（Inspector 可见） | 仅 Inspector Events tab |

开发者不需要直接处理事件——用 `useAgent` hook 拿到的 `agent.messages` / `agent.state` / `agent.isRunning` 是 AG-UI 事件流的最终产物。

## Inspector 里看到的就是这些

Inspector 的 Events tab 显示所有 AG-UI 事件。200 个事件里：

- **值得关注的**：TEXT_MESSAGE_*, TOOL_CALL_*, STATE_*, RUN_ERROR
- **可以忽略的**：RAW（LangChain 内部细节，debug 时才看）

Inspector 的 Total Events 计数包含 RAW 事件，所以数字看起来很大。实际有意义的业务事件大约是总数的一半。

## 与 Vercel AI SDK 的对比

| | AG-UI (CopilotKit) | Vercel AI SDK (Inbox) |
|---|---|---|
| 协议 | 细粒度事件流（START/CONTENT/END/TOOL_CALL 等） | 简单文本流（data: "token"） |
| 事件数 | ~200/条消息 | ~50/条消息（纯 token chunk） |
| Tool 调用 | 专用事件类型，前端实时渲染 tool 状态 | 编码在消息 JSON 中 |
| Agent 状态 | STATE_SNAPSHOT/DELTA 实时同步 | 无 |
| Debug | RAW 事件透传 LangChain 内部状态 | 无 |
| 适用场景 | Agent 交互（tool calling, 状态管理, 多轮） | 简单 Chat（纯文本问答） |

AG-UI 事件多不是缺陷——它是为 Agent 交互设计的，比纯文本流多出的事件承载了 tool 调用、状态同步、debug 信息等 Agent 所需的完整语义。
