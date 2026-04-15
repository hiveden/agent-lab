# CopilotKit + LangGraph 集成参考

> 基于 CopilotKit v1.55.3 + ag-ui-langgraph v0.0.30 + copilotkit(python) v0.1.74 源码整理

## CopilotKit 定位

前端 Agent 框架，把 Python LangGraph agent 接入 React UI 的胶水层。三层：
- 前端: `@copilotkit/react-core` + `react-ui` — Provider + Chat UI + hooks
- BFF: `@copilotkit/runtime` — CopilotRuntime SSE 代理
- Python: `copilotkit` + `ag-ui-langgraph` — LangGraph 包装为 AG-UI 端点

## BFF 端点协议

CopilotKit 使用 single-route JSON envelope 格式（不是裸 REST）：

```json
POST /api/agent/chat
{
  "method": "agent/run" | "agent/connect" | "agent/stop" | "info" | "transcribe",
  "params": { "agentId": "radar" },
  "body": { "threadId": "...", "runId": "...", "messages": [], "state": {}, "tools": [], "context": [] }
}
```

合法 method: `agent/run`, `agent/connect`, `agent/stop`, `info`, `transcribe`

## CopilotRuntime 配置

```typescript
import { CopilotRuntime, ExperimentalEmptyAdapter, copilotRuntimeNextJSAppRouterEndpoint } from "@copilotkit/runtime";
import { LangGraphHttpAgent } from "@copilotkit/runtime/langgraph";

// agents 是 Record<string, AbstractAgent>（对象，不是数组）
// ExperimentalEmptyAdapter 就是 EmptyAdapter 别名，LangGraph 场景标准做法
const copilotRuntime = new CopilotRuntime({
  agents: {
    radar: new LangGraphHttpAgent({
      url: `${BASE_URL}/agent/chat`,  // 完整端点 URL，HttpAgent.run() 直接 fetch 此 URL
    }),
  },
});
```

## 前端核心 Hooks

### `<CopilotKit>` Provider
```tsx
<CopilotKit runtimeUrl="/api/agent/chat" agent="radar" showDevConsole={true}>
  {children}
</CopilotKit>
```
- `agent` prop 对应 Runtime agents 字典的 key
- `showDevConsole`: localhost 默认 true，生产设 false

### `useCoAgent` — 前后端共享 state（核心 hook）
```tsx
import { useCoAgent } from "@copilotkit/react-core";
const { state, setState, run } = useCoAgent<MyState>({
  name: "radar",        // 对应 Python 端 agent name
  initialState: {},
});
```
- `state`: 实时同步 LangGraph agent 的 state
- `setState`: 前端修改 state，推给 agent
- `run`: 手动触发 agent 执行

### `useCoAgentStateRender` — 渲染 agent state 变化
```tsx
import { useCoAgentStateRender } from "@copilotkit/react-core";
useCoAgentStateRender({
  name: "radar",
  render: ({ state }) => {
    if (state.progress) return <ProgressBar value={state.progress} />;
    return null;
  },
});
```

### `useCopilotAction` — 前端注册 tool 给 agent 调用
```tsx
import { useCopilotAction } from "@copilotkit/react-core";
useCopilotAction({
  name: "navigate_to_item",
  description: "Navigate to a specific item",
  parameters: [{ name: "itemId", type: "string" }],
  handler: ({ itemId }) => { /* 前端逻辑 */ },
});
```

### `useCopilotReadable` — 注入上下文给 agent
```tsx
import { useCopilotReadable } from "@copilotkit/react-core";
useCopilotReadable({
  description: "当前用户选中的 item",
  value: JSON.stringify(selectedItem),
});
```

### `useCopilotChat` vs `useCopilotChatInternal`
- `useCopilotChat`（公开）: 有 `visibleMessages`, `appendMessage`(deprecated), `stopGeneration`, `isLoading`
- `useCopilotChatInternal`（内部）: 额外有 `messages`(AG-UI格式), `sendMessage`, `setMessages`, `deleteMessage`
- `useCopilotChatHeadless_c`（Premium）: 完整版，需 `publicApiKey`

### `CopilotChat` 组件
```tsx
<CopilotChat
  className="h-full"
  labels={{ placeholder: "和 Agent 对话...", initial: "开始对话", stopGenerating: "停止" }}
  instructions="你是一个助手"  // 可选 system prompt 补充
/>
```

## Python 端 AG-UI 集成

### FastAPI 端点注册
```python
from ag_ui_langgraph import add_langgraph_fastapi_endpoint
from copilotkit import LangGraphAGUIAgent

agent = LangGraphAGUIAgent(name="radar", graph=compiled_graph, description="...")
add_langgraph_fastapi_endpoint(app, agent, path="/agent/chat")
# 注册: POST /agent/chat + GET /agent/chat/health
# 每请求 agent.clone() 保证并发安全
```

### CopilotKitState
```python
from copilotkit import CopilotKitState
class AgentState(CopilotKitState):  # 继承 MessagesState + copilotkit 字段
    remaining_steps: NotRequired[RemainingSteps]
```

### 状态发射 — copilotkit_emit_state
```python
from copilotkit import copilotkit_emit_state
async def my_node(state, config):
    await copilotkit_emit_state(config, {"progress": 50, "step": "evaluating"})
```

### 消息发射 — copilotkit_emit_message
```python
from copilotkit import copilotkit_emit_message
async def my_node(state, config):
    await copilotkit_emit_message(config, "正在处理中...")
```

### 配置定制 — copilotkit_customize_config
```python
from copilotkit import copilotkit_customize_config
async def tool_node(state, config):
    config = copilotkit_customize_config(config, emit_messages=False, emit_tool_calls=True)
```

### LangGraphAGUIAgent 处理的自定义事件
- `copilotkit_manually_emit_message` → TextMessage 三件套
- `copilotkit_manually_emit_tool_call` → ToolCall 三件套
- `copilotkit_manually_emit_intermediate_state` → StateSnapshot
- `copilotkit_exit` → Custom "Exit" event

## Dev Console 四个 Tab

| Tab | 显示 | 需要什么 |
|-----|------|---------|
| Events | AG-UI SSE 事件流 (RUN_STARTED, TEXT_MESSAGE_*, TOOL_CALL_*, STATE_SNAPSHOT) | 有对话就有 |
| Agent | agent state、执行状态 | `useCoAgent` hook |
| FrontendTools | 前端注册的 tools | `useCopilotAction` |
| Context | 前端注入的上下文 | `useCopilotReadable` |

## AG-UI 事件类型完整列表

文本: TEXT_MESSAGE_START / TEXT_MESSAGE_CONTENT / TEXT_MESSAGE_END / TEXT_MESSAGE_CHUNK
Tool: TOOL_CALL_START / TOOL_CALL_ARGS / TOOL_CALL_END / TOOL_CALL_CHUNK / TOOL_CALL_RESULT
状态: STATE_SNAPSHOT / STATE_DELTA / MESSAGES_SNAPSHOT
活动: ACTIVITY_SNAPSHOT / ACTIVITY_DELTA
推理: REASONING_START / REASONING_MESSAGE_START/CONTENT/END / REASONING_END
生命周期: RUN_STARTED / RUN_FINISHED / RUN_ERROR / STEP_STARTED / STEP_FINISHED
通用: RAW / CUSTOM

## 关键源码位置

- CopilotRuntime: `@copilotkit/runtime/src/lib/runtime/copilot-runtime.ts`
- Method 验证: `@copilotkit/runtime/src/v2/runtime/endpoints/single-route-helpers.ts`
- LangGraphHttpAgent: `@ag-ui/langgraph` re-export, 继承 `@ag-ui/client` 的 HttpAgent
- useCopilotChat: `@copilotkit/react-core/src/hooks/use-copilot-chat.ts`
- Python LangGraphAGUIAgent: `copilotkit/langgraph_agui_agent.py`
- Python CopilotKitState: `copilotkit/langgraph.py`
- ag-ui endpoint: `ag_ui_langgraph/endpoint.py`
