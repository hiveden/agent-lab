# CopilotKit + LangGraph 集成参考

> 基于 CopilotKit v1.55.3 (v2 API) + ag-ui-langgraph v0.0.30 + copilotkit(python) v0.1.74

## CopilotKit 定位

前端 Agent 框架，把 Python LangGraph agent 接入 React UI 的胶水层。三层：
- 前端: `@copilotkit/react-core/v2` — Provider + Chat UI + hooks（v2 合并了 react-ui）
- BFF: `@copilotkit/runtime` — CopilotRuntime SSE 代理
- Python: `copilotkit` + `ag-ui-langgraph` — LangGraph 包装为 AG-UI 端点

## v1 vs v2 API

| | v1 (`@copilotkit/react-core` + `react-ui`) | v2 (`@copilotkit/react-core/v2`) |
|---|---|---|
| Chat UI | `import { CopilotChat } from '@copilotkit/react-ui'` | `import { CopilotChat } from '@copilotkit/react-core/v2'` |
| CSS | `import '@copilotkit/react-ui/styles.css'` | `import '@copilotkit/react-core/v2/styles.css'`（Tailwind v4） |
| Agent hook | `useCoAgent` + `useCopilotChatInternal`（内部 API） | `useAgent`（公开 API，AbstractAgent 实例） |
| Context | `useCopilotReadable` | `useAgentContext` |
| Frontend tool | `useCopilotAction` | `useFrontendTool`（Zod schema） |
| Tool render | `RenderMessage` prop | `useRenderTool` / slots |
| Markdown | react-markdown | **streamdown**（AI streaming 专用） |

**项目当前用 v2 API。**

## BFF 端点协议

CopilotKit 使用 single-route JSON envelope 格式：

```json
POST /api/agent/chat
{
  "method": "agent/run" | "agent/connect" | "agent/stop" | "info" | "transcribe",
  "params": { "agentId": "radar" },
  "body": { "threadId": "...", "runId": "...", "messages": [], "state": {}, "tools": [], "context": [] }
}
```

## BFF Runtime 配置

```typescript
import { CopilotRuntime, ExperimentalEmptyAdapter, copilotRuntimeNextJSAppRouterEndpoint } from "@copilotkit/runtime";
import { LangGraphHttpAgent } from "@copilotkit/runtime/langgraph";

const radarAgent = new LangGraphHttpAgent({
  url: `${BASE_URL}/agent/chat`,
});

const copilotRuntime = new CopilotRuntime({
  agents: {
    radar: radarAgent,
    default: radarAgent,  // v2 的 CopilotChat 内部 useAgent() 不带 agentId 时找 'default'
  },
});
```

**注意**：必须注册 `default` key，否则 v2 CopilotChat 内部的隐式 `useAgent()` 报错。

## 前端 v2 API

### Import

```tsx
import {
  CopilotKit,
  CopilotChat,
  useAgent,
  useAgentContext,
  useFrontendTool,
  useRenderTool,
  type Message,
  type AssistantMessage,
  type ToolMessage,
} from '@copilotkit/react-core/v2';
import '@copilotkit/react-core/v2/styles.css';  // 必须显式 import，Tailwind v4 CSS
```

### Provider

```tsx
<CopilotKit runtimeUrl="/api/agent/chat">
  {children}
</CopilotKit>
```

注意：v2 的 `CopilotKit` 没有 `agent` prop（v1 有）。agentId 在 `useAgent` 和 `CopilotChat` 上指定。

### useAgent — 核心 hook

```tsx
const { agent } = useAgent({ agentId: 'radar' });

// agent 是 AbstractAgent 实例：
agent.messages       // Message[]
agent.state          // State (Record<string, any>)
agent.isRunning      // boolean
agent.threadId       // string
agent.agentId        // string
agent.setMessages(newMessages)
agent.setState(newState)
agent.addMessage(msg)
agent.runAgent(params, subscriber)  // 手动执行
agent.abortRun()                    // 中止
```

### useAgentContext — 前端 context 注入

声明式注入前端数据到 AG-UI 协议的 `context[]` 数组，每次 `agent/run` 请求自动携带。

```tsx
// AgentViewInner 中的实际用法：
const [configVersion, bumpConfigVersion] = useReducer((x) => x + 1, 0);
const userPreferences = useMemo(() => buildPromptFromCards(), [configVersion]);
useAgentContext({
  description: '用户偏好配置（使命、推荐偏好、过滤规则、质量门槛、背景、兴趣、反感内容）',
  value: userPreferences,  // JsonSerializable，自动 JSON.stringify
});

// ConfigCards 变更时触发 bumpConfigVersion → useMemo 重算 → context 自动更新
<ConfigCards onChange={bumpConfigVersion} />
```

**注意**: `AgentContextInput` 只有 `description` + `value`，没有 `agentId` 字段。context 注入是 provider 级别的，对所有 agent 生效。

### useFrontendTool — 浏览器端 tool

**重要概念区分**: `useFrontendTool` 注册的是**在浏览器中执行**的 tool，不是 Python Agent 侧的 tool。

| | Frontend Tool (`useFrontendTool`) | Server Tool (Python) |
|---|---|---|
| 执行环境 | 浏览器 | Python Agent Server |
| 注册方式 | React hook | LangGraph `create_react_agent(tools=[...])` |
| 典型场景 | 显示通知、打开面板、操作 UI | 调用 API、查询数据库、评估内容 |
| Inspector 可见位置 | **Tools tab**（schema 定义） | **Events tab**（TOOL_CALL_START/ARGS/END） |

当前项目的 tool（evaluate、ingest 等）全在 Python 侧，前端没有 `useFrontendTool` 的场景，所以 Inspector Tools tab 为空是正常的。

```tsx
// 示例：如果需要 Agent 操作前端 UI
useFrontendTool({
  name: 'show_notification',
  description: '显示通知',
  parameters: z.object({
    message: z.string(),
    type: z.string().optional(),
  }),
  handler: async (args, context) => {
    toast.info(args.message);
  },
  available: true,
  render: MyToolRenderer,
}, [deps]);
```

### useRenderTool — 纯渲染 tool call

```tsx
useRenderTool({
  name: '*',  // 通配符：渲染所有 tool call
  render: ({ name, status, parameters, result }) => (
    <ToolCallCard name={name} status={status} args={parameters} result={result} />
  ),
}, []);
```

### Preset 消息发送

```tsx
// v1: sendMessage({ id, role, content })
// v2:
agent.addMessage({ id: crypto.randomUUID(), role: 'user', content: msg });
agent.runAgent();
```

## CopilotChat v2 组件

### Props

```tsx
<CopilotChat
  agentId="radar"              // 绑定 agent
  threadId="thread-123"        // 绑定 thread
  className="h-full"
  labels={{
    chatInputPlaceholder: '和 Radar 对话...',
    welcomeMessageText: '开始对话',
  }}
  onStop={() => agent.abortRun()}
  onSubmitMessage={(value) => { ... }}
  throttleMs={100}
  messageView={{ className: 'custom' }}     // Slot 覆盖
  input={{ className: 'custom' }}
  onError={({ error, code, context }) => { ... }}
  attachments={{ enabled: true }}
/>
```

### 样式定制

CopilotChat 的样式定制（Slot 系统、CSS 覆盖、组件层级、常见问题）见独立文档：
**[16-COPILOTKIT-STYLING.md](./16-COPILOTKIT-STYLING.md)**

## CSS

v2 CSS 必须显式 import：`import '@copilotkit/react-core/v2/styles.css'`

项目样式覆盖统一在 `apps/web/src/app/copilotkit-theme.css`（变量层 + 布局层），详见 [样式定制指南](./16-COPILOTKIT-STYLING.md)。

## Python 端 AG-UI 集成

### FastAPI 端点注册

```python
from ag_ui_langgraph import add_langgraph_fastapi_endpoint
from copilotkit import LangGraphAGUIAgent

agent = LangGraphAGUIAgent(name="radar", graph=compiled_graph)
add_langgraph_fastapi_endpoint(app, agent, path="/agent/chat")
```

### 状态发射

```python
from copilotkit.langgraph import copilotkit_emit_state, copilotkit_emit_message

async def my_node(state, config):
    await copilotkit_emit_state(config, {"progress": {"step": "evaluating", "total": 10}})
    await copilotkit_emit_message(config, "正在处理...")
```

### CopilotKitState

```python
from copilotkit import CopilotKitState
class AgentState(CopilotKitState):
    remaining_steps: NotRequired[RemainingSteps]
```

## Dev Console / Inspector

v2 API 通过 `showDevConsole` prop 启用 AG-UI Inspector（Lit web component `<cpk-web-inspector>`）：

```tsx
<CopilotKit runtimeUrl="/api/agent/chat" showDevConsole>
```

### Inspector Tab 说明

| Tab | 内容 | 数据来源 |
|-----|------|---------|
| **Events** | AG-UI 原始事件流（RUN_STARTED, TEXT_MESSAGE_*, TOOL_CALL_*, STATE_* 等） | Agent SSE 事件，含 Python 侧 tool 调用 |
| **Tools** | 前端 tool schema 定义 | `useFrontendTool()` 注册（浏览器端执行的 tool） |
| **Context** | 注入给 Agent 的前端 context | `useAgentContext()` 注册 |
| **State** | Agent 当前 state 快照 | `agent.state`（Python `copilotkit_emit_state` 发射） |
| **Messages** | Agent 消息列表 | `agent.messages` |

**常见误解**: Python 侧的 tool（evaluate、ingest 等）不会出现在 Tools tab。它们的调用事件在 **Events tab** 中以 `TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_END` 形式展示。

### Inspector thread clone bug（v1.55.3）

**现象**: Inspector 渲染但显示 0 events，chat 正常。

**根因**: `CopilotChat` 内部总是 `randomUUID()` 生成 threadId → `getOrCreateThreadClone()` 创建独立 clone → 事件在 clone 上触发。Inspector 只订阅 `core.agents` registry 中的原始 agent，收不到 clone 事件。

**上游修复**: [PR #3872](https://github.com/CopilotKit/CopilotKit/pull/3872)（2026-04-13 合并，晚于 v1.55.3 两天，尚未发布 stable）。

**当前 workaround**（`AgentView.tsx`）:
1. 稳定 threadId — `useMemo(() => crypto.randomUUID(), [])` 共享给 `useAgent` 和 `CopilotChat`
2. DOM bridge — `document.querySelector('cpk-web-inspector').subscribeToAgent(agent)` 直接订阅 clone

**TODO**: 升级到包含 PR #3872 的版本后删除 workaround 代码。

## 已知问题

1. **v2 CopilotChat 内部隐式 useAgent() 找 'default'** — runtime 必须注册 `default` agent key
2. **v2 CSS 需要 Tailwind v4** — 项目已升级
3. **v2 CSS 需要显式 import** — `@copilotkit/react-core/v2/styles.css`
4. **Ollama streaming 重复事件** — agui_tracing.py 去重层处理
5. **useCopilotChatInternal（v1 内部 API）已废弃** — v2 用 useAgent 替代
6. **Inspector 0 events（v1.55.3）** — thread clone 不在 registry，已有 workaround，见上方 Dev Console 章节

## 参考

- [v2 迁移指南](../docs/COPILOTKIT-V2-MIGRATION.md)
- [CopilotKit v2 examples](https://github.com/CopilotKit/CopilotKit/tree/main/examples/v2)
- [useAgent tutorial](https://aihola.com/article/copilotkit-useagent-ag-ui-tutorial)
- [Issue #3205: Agent not found error](https://github.com/CopilotKit/CopilotKit/issues/3205)
- [Issue #2949: Programmatic initial message](https://github.com/CopilotKit/CopilotKit/issues/2949)
- [PR #3872: Inspector thread clone fix](https://github.com/CopilotKit/CopilotKit/pull/3872)
- [Slots docs](https://docs.copilotkit.ai/built-in-agent/custom-look-and-feel/slots)
