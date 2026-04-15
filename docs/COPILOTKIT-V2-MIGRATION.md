# CopilotKit v2 Migration Guide

> 基于已安装的 `@copilotkit/react-core@1.55.3` 和 `@copilotkit/react-ui@1.55.3` 的类型定义，完整记录 v1 到 v2 的 API 变更。

---

## 目录

1. [Import 路径变更](#1-import-路径变更)
2. [Provider 变更: CopilotKit](#2-provider-变更-copilotkit)
3. [核心 Hooks 变更](#3-核心-hooks-变更)
4. [CopilotChat 组件变更](#4-copilotchat-组件变更)
5. [CopilotSidebar / CopilotPopup 变更](#5-copilotsidebar--copilotpopup-变更)
6. [消息组件变更](#6-消息组件变更)
7. [CSS / 样式变更](#7-css--样式变更)
8. [v2 全新 API](#8-v2-全新-api)
9. [AbstractAgent (ag-ui/client)](#9-abstractagent-ag-uiclient)
10. [Streamdown 组件](#10-streamdown-组件)
11. [逐步迁移清单](#11-逐步迁移清单)

---

## 1. Import 路径变更

**关键变更**: v2 的所有 API 从 `@copilotkit/react-core/v2` 导入。v1 的 `@copilotkit/react-ui` 被废弃——v2 的 UI 组件全部内置在 `@copilotkit/react-core/v2` 中。

```tsx
// ---- v1 ----
import { CopilotKit, useCopilotReadable, useCopilotAction, useCoAgent } from '@copilotkit/react-core';
import { CopilotChat, CopilotSidebar, CopilotPopup } from '@copilotkit/react-ui';
import '@copilotkit/react-ui/styles.css';

// ---- v2 ----
import {
  CopilotKit,           // Provider (同名，新实现)
  CopilotChat,          // UI 组件，直接从 react-core/v2 导入
  CopilotSidebar,
  CopilotPopup,
  useAgent,             // 替代 useCoAgent / useCopilotChat
  useAgentContext,      // 替代 useCopilotReadable
  useFrontendTool,      // 替代 useCopilotAction
  useRenderTool,        // 新增：纯渲染 tool call
  useInterrupt,         // 替代 useLangGraphInterrupt
  useThreads,           // 新增：线程管理
  useSuggestions,       // 新增：suggestions 消费
} from '@copilotkit/react-core/v2';
import '@copilotkit/react-core/v2/index.css';  // CSS 路径也变了
```

**v2 还会 re-export 所有 `@copilotkit/core` 和 `@ag-ui/client` 的类型**，所以 `Message`, `ToolCall`, `AbstractAgent` 等可以直接从 `@copilotkit/react-core/v2` 导入。

---

## 2. Provider 变更: CopilotKit

### v1 CopilotKit (Provider)

```tsx
// v1
<CopilotKit
  runtimeUrl="/api/copilotkit"
  publicApiKey="..."
  headers={{ Authorization: 'Bearer ...' }}
  credentials="include"
  showDevConsole={true}
>
```

### v2 CopilotKit / CopilotKitProvider

```tsx
// v2 — CopilotKit 是 CopilotKitProvider 的封装
<CopilotKit
  runtimeUrl="/api/copilotkit"
  publicApiKey="..."          // 或 publicLicenseKey
  licenseToken="..."          // 新增：离线许可验证
  headers={{ Authorization: 'Bearer ...' }}
  credentials="include"
  showDevConsole={true}       // 仍支持

  // ---- v2 新增 props ----
  selfManagedAgents={{ myAgent: httpAgent }}  // 自托管 AG-UI Agent
  renderToolCalls={[...]}        // 全局 tool call 渲染器
  renderActivityMessages={[...]} // 全局 activity 消息渲染器
  renderCustomMessages={[...]}   // 全局自定义消息渲染器
  frontendTools={[...]}          // 全局前端 tools
  humanInTheLoop={[...]}         // 全局 HITL tools
  defaultThrottleMs={100}        // 默认 useAgent 节流
  inspectorDefaultAnchor={{ horizontal: 'right', vertical: 'top' }}
  a2ui={{                        // A2UI 渲染器配置
    theme: myCustomTheme,
    catalog: myCatalog,
    loadingComponent: MyLoader,
    includeSchema: true,
  }}
  openGenerativeUI={{            // 沙盒 UI
    sandboxFunctions: [...],
    designSkill: '...',
  }}
  onError={({ error, code, context }) => { ... }}  // 全局错误处理
>
```

### v2 `CopilotKitProviderProps` 完整接口

| Prop | 类型 | 说明 |
|------|------|------|
| `runtimeUrl` | `string?` | CopilotKit runtime URL |
| `headers` | `Record<string, string>?` | 请求头 |
| `credentials` | `RequestCredentials?` | fetch 凭证模式 |
| `publicApiKey` | `string?` | Cloud API key |
| `publicLicenseKey` | `string?` | `publicApiKey` 别名 |
| `licenseToken` | `string?` | 离线许可 token |
| `properties` | `Record<string, unknown>?` | 自定义属性 |
| `useSingleEndpoint` | `boolean?` | 单 endpoint 模式 |
| `selfManagedAgents` | `Record<string, AbstractAgent>?` | 自托管 agent |
| `renderToolCalls` | `ReactToolCallRenderer[]?` | 全局 tool call 渲染器 |
| `renderActivityMessages` | `ReactActivityMessageRenderer[]?` | 全局 activity 消息渲染器 |
| `renderCustomMessages` | `ReactCustomMessageRenderer[]?` | 全局自定义消息渲染器 |
| `frontendTools` | `ReactFrontendTool[]?` | 全局前端 tools |
| `humanInTheLoop` | `ReactHumanInTheLoop[]?` | 全局 HITL tools |
| `showDevConsole` | `boolean \| "auto"?` | DevConsole |
| `onError` | `(event) => void?` | 全局错误回调 |
| `a2ui` | `{ theme?, catalog?, loadingComponent?, includeSchema? }?` | A2UI 配置 |
| `defaultThrottleMs` | `number?` | useAgent 默认节流 |
| `openGenerativeUI` | `{ sandboxFunctions?, designSkill? }?` | 沙盒 UI |
| `inspectorDefaultAnchor` | `Anchor?` | Inspector 默认锚点 |

---

## 3. 核心 Hooks 变更

### 3.1 `useCopilotReadable` -> `useAgentContext`

```tsx
// ---- v1 ----
useCopilotReadable({
  description: '当前选中的项目列表',
  value: selectedItems,           // any
  parentId: parentContextId,      // 嵌套上下文
  categories: ['chat'],           // 可见性分类
  available: 'enabled',
  convert: (desc, val) => '...',  // 自定义序列化
});

// ---- v2 ----
useAgentContext({
  description: '当前选中的项目列表',
  value: selectedItems,  // JsonSerializable（自动 JSON.stringify）
});
// 注意：v2 去掉了 parentId、categories、available、convert
// 上下文通过 useLayoutEffect 注册，在 runAgent 前自动刷新
```

**`AgentContextInput` 接口**:
```ts
interface AgentContextInput {
  description: string;
  value: JsonSerializable;  // string | number | boolean | null | 数组 | 对象
}
```

### 3.2 `useCopilotAction` -> `useFrontendTool`

```tsx
// ---- v1 ----
useCopilotAction({
  name: 'searchItems',
  description: '搜索条目',
  parameters: [
    { name: 'query', type: 'string', description: '搜索关键词' },
    { name: 'limit', type: 'number', description: '结果数量' },
  ],
  handler: async ({ query, limit }) => { ... },
  render: (props) => {
    // props.status: 'inProgress' | 'executing' | 'complete'
    // props.args: { query, limit }
    // props.result
    return <SearchResultsCard {...props} />;
  },
}, [deps]);

// ---- v2 ----
useFrontendTool({
  name: 'searchItems',
  description: '搜索条目',
  parameters: z.object({           // Standard Schema V1（Zod/Valibot/ArkType）
    query: z.string(),
    limit: z.number(),
  }),
  handler: async (args, context) => {
    // args: { query: string, limit: number } — 类型推导自 schema
    // context: { toolCall, agent, signal? }
    return results;
  },
  followUp: true,                  // 是否在 tool 完成后继续对话
  agentId: 'radar',                // 可选：限定 agent
  available: true,                 // boolean，替代旧的 disabled / available 字符串
  render: MyToolCallRenderer,      // ComponentType<{ name, args, status, result }>
}, [deps]);
```

**`ReactFrontendTool` 接口**:
```ts
type ReactFrontendTool<T extends Record<string, unknown>> = {
  name: string;
  description?: string;
  parameters?: StandardSchemaV1<any, T>;
  handler?: (args: T, context: FrontendToolHandlerContext) => Promise<unknown>;
  followUp?: boolean;
  agentId?: string;
  available?: boolean;
  render?: React.ComponentType<
    | { name: string; args: Partial<T>; status: 'inProgress'; result: undefined }
    | { name: string; args: T; status: 'executing'; result: undefined }
    | { name: string; args: T; status: 'complete'; result: string }
  >;
};
```

**关键差异**:
- `parameters` 从 CopilotKit 自定义 `Parameter[]` 改为 Standard Schema V1 (Zod, Valibot, ArkType)
- `handler` 新增 `context` 参数，含 `toolCall`、`agent`、`signal`
- `render` 从函数改为 `ComponentType`，props 中 `args` 替代了旧的分散参数
- `available` 从字符串 `"enabled" | "disabled"` 改为 `boolean`

### 3.3 `useCoAgent` -> `useAgent`

```tsx
// ---- v1 ----
const { state, setState, running, start, stop, run, nodeName, threadId } = useCoAgent({
  name: 'radar',
  initialState: { query: '' },
  config: { configurable: { ... } },
});

// ---- v2 ----
const { agent } = useAgent({
  agentId: 'radar',            // 对应 v1 的 name
  threadId: 'thread-123',     // 可选
  updates: [                   // 控制哪些变更触发 re-render
    UseAgentUpdate.OnMessagesChanged,
    UseAgentUpdate.OnStateChanged,
    UseAgentUpdate.OnRunStatusChanged,
  ],
  throttleMs: 100,             // 节流 re-render
});

// agent 是 AbstractAgent 实例，包含：
agent.messages;       // Message[]
agent.state;          // State (Record<string, any>)
agent.isRunning;      // boolean
agent.threadId;       // string
agent.agentId;        // string
agent.setMessages(newMessages);
agent.setState(newState);
agent.addMessage(msg);
agent.runAgent(params, subscriber);    // 手动执行
agent.abortRun();                      // 中止执行
agent.subscribe(subscriber);          // 订阅事件
agent.use(middleware);                 // 中间件
```

**`UseAgentProps` 接口**:
```ts
enum UseAgentUpdate {
  OnMessagesChanged = 'OnMessagesChanged',
  OnStateChanged = 'OnStateChanged',
  OnRunStatusChanged = 'OnRunStatusChanged',
}

interface UseAgentProps {
  agentId?: string;
  threadId?: string;
  updates?: UseAgentUpdate[];
  throttleMs?: number;  // 仅影响 OnMessagesChanged，默认 0（无节流）
}
```

### 3.4 `useCopilotChat` -> 在 v2 中被废弃

v1 的 `useCopilotChat` 提供了命令式 chat 控制（sendMessage, setMessages, isLoading, etc.）。在 v2 中，这些功能直接通过 `useAgent()` 返回的 `AbstractAgent` 实例完成：

```tsx
// ---- v1 ----
const { messages, sendMessage, setMessages, isLoading, stopGeneration, reset } = useCopilotChat();

// ---- v2 ----
const { agent } = useAgent({ agentId: 'radar' });
// agent.messages             替代 messages
// agent.runAgent()           替代 sendMessage
// agent.setMessages([])      替代 setMessages / reset
// agent.isRunning            替代 isLoading
// agent.abortRun()           替代 stopGeneration
```

### 3.5 `useLangGraphInterrupt` -> `useInterrupt`

```tsx
// ---- v1 ----
useLangGraphInterrupt({
  handler: async ({ event, resolve }) => {
    // 处理中断
  },
  render: ({ event, result, resolve }) => (
    <div>
      <p>{event.value.question}</p>
      <button onClick={() => resolve({ approved: true })}>批准</button>
    </div>
  ),
  enabled: ({ eventValue, agentMetadata }) => eventValue.type === 'approval',
  agentId: 'radar',
});

// ---- v2 ----
useInterrupt({
  render: ({ event, result, resolve }) => (
    <div>
      <p>{event.value.question}</p>
      <button onClick={() => resolve({ approved: true })}>批准</button>
    </div>
  ),
  handler: async ({ event, resolve }) => {
    // 可选预处理，返回值作为 render 的 result
    return { label: event.value.toUpperCase() };
  },
  enabled: (event: InterruptEvent) => event.value.type === 'approval',
  agentId: 'radar',
  renderInChat: true,  // true(默认)：在 CopilotChat 内渲染；false：自行渲染
});

// renderInChat: false 时，hook 返回 ReactElement | null
const interruptElement = useInterrupt({
  renderInChat: false,
  render: ({ event, resolve }) => <MyCustomInterrupt event={event} onResolve={resolve} />,
});
// 然后在你的组件中渲染 interruptElement
```

**`InterruptEvent` / `InterruptRenderProps` 接口**:
```ts
interface InterruptEvent<TValue = unknown> {
  name: string;
  value: TValue;
}
interface InterruptRenderProps<TValue = unknown, TResult = unknown> {
  event: InterruptEvent<TValue>;
  result: TResult;            // handler 返回值或 null
  resolve: (response: unknown) => void;
}
```

### 3.6 `useCopilotChatSuggestions` -> `useConfigureSuggestions` + `useSuggestions`

```tsx
// ---- v1 ----
useCopilotChatSuggestions({
  instructions: '根据当前上下文生成建议',
  minSuggestions: 1,
  maxSuggestions: 3,
  available: 'enabled',
});

// ---- v2 ----
// 配置端（注册 suggestions 规则）
useConfigureSuggestions({
  instructions: '根据当前上下文生成建议',
  minSuggestions: 1,
  maxSuggestions: 3,
}, [deps]);

// 或静态 suggestions
useConfigureSuggestions({
  suggestions: [
    { title: '帮我评判', message: '帮我评判今天的新内容' },
    { title: '采集更新', message: '从 HN 采集最新内容' },
  ],
}, []);

// 消费端（读取 suggestions 状态）
const { suggestions, reloadSuggestions, clearSuggestions, isLoading } = useSuggestions({
  agentId: 'radar',  // 可选
});
```

### 3.7 `useCoAgentStateRender` -> 在 v2 中通过 `renderActivityMessages` 替代

```tsx
// ---- v1 ----
useCoAgentStateRender({
  name: 'radar',
  nodeName: 'evaluate',
  render: ({ state, nodeName, status }) => (
    <EvaluationProgress state={state} status={status} />
  ),
  handler: ({ nodeName, state }) => { ... },
});

// ---- v2 ----
// 方式 1：在 Provider 全局注册
<CopilotKit renderActivityMessages={[{
  activityType: 'evaluation-progress',
  agentId: 'radar',
  content: z.object({ progress: z.number(), total: z.number() }),
  render: ({ activityType, content, message, agent }) => (
    <EvaluationProgress progress={content.progress} total={content.total} />
  ),
}]}>

// 方式 2：使用 useRenderTool 渲染 tool call 中间状态
useRenderTool({
  name: 'evaluate',
  parameters: z.object({ batchSize: z.number() }),
  render: ({ name, status, parameters, result }) => (
    <EvaluationCard status={status} batchSize={parameters.batchSize} result={result} />
  ),
}, []);
```

### 3.8 `useMakeCopilotDocumentReadable` -> 在 v2 中去掉

v2 中没有直接的替代。使用 `useAgentContext` 传递文档内容：

```tsx
// ---- v1 ----
useMakeCopilotDocumentReadable({
  id: 'doc-1',
  name: 'attention-config.json',
  sourceApplication: 'radar',
  iconImageUri: '...',
  getContents: () => JSON.stringify(config),
});

// ---- v2 ----
useAgentContext({
  description: 'Attention configuration document (attention-config.json)',
  value: config,  // 自动 JSON.stringify
});
```

### 3.9 `useCopilotAdditionalInstructions` -> 在 v2 中去掉

v2 中没有直接对应。在 Agent 端通过 system prompt 或 `useAgentContext` 实现。

---

## 4. CopilotChat 组件变更

### v1 CopilotChat (from `@copilotkit/react-ui`)

```tsx
<CopilotChat
  instructions="你是 Radar Agent..."
  suggestions="auto"
  labels={{ title: 'Radar', placeholder: '输入消息...', initial: '你好！' }}
  icons={{ sendIcon: <MySendIcon /> }}
  onSubmitMessage={async (msg) => { ... }}
  onInProgress={(loading) => { ... }}
  onStopGeneration={({ currentAgentName, messages }) => { ... }}
  onReloadMessages={({ messageId }) => { ... }}
  onRegenerate={(messageId) => { ... }}
  onCopy={(content) => { ... }}
  onThumbsUp={(message) => { ... }}
  onThumbsDown={(message) => { ... }}
  makeSystemMessage={(ctx, inst) => '...'}
  markdownTagRenderers={{ myTag: MyComponent }}
  AssistantMessage={CustomAssistantMsg}
  UserMessage={CustomUserMsg}
  RenderMessage={CustomRenderMsg}
  Messages={CustomMessagesContainer}
  Input={CustomInput}
  RenderSuggestionsList={CustomSuggestions}
  ImageRenderer={CustomImageRenderer}
  attachments={{ enabled: true }}
  hideStopButton={false}
  observabilityHooks={{ onMessageSent: (msg) => { ... } }}
  renderError={({ message, onDismiss }) => <ErrorBanner />}
  className="my-chat"
/>
```

### v2 CopilotChat (from `@copilotkit/react-core/v2`)

```tsx
<CopilotChat
  agentId="radar"                // 新增：绑定 agent
  threadId="thread-123"          // 新增：绑定 thread
  throttleMs={100}               // 新增：节流
  attachments={{ enabled: true }}
  isModalDefaultOpen={true}

  labels={{                       // labels 结构完全不同（见下方）
    chatInputPlaceholder: '输入消息...',
    modalHeaderTitle: 'Radar Agent',
    welcomeMessageText: '你好！我是 Radar Agent。',
    // ... 更多 label keys
  }}

  // Slot-based 自定义 — 替代旧的 Component props
  chatView={myChatViewSlot}       // 替代 Messages
  // 每个 slot 可以传递：
  //   - 组件类型（整体替换）
  //   - 字符串 className
  //   - Partial<ComponentProps>（覆盖部分 props）

  // 错误处理
  onError={({ error, code, context }) => { ... }}

  className="my-chat"

  // 底层 CopilotChatViewProps（透传到 CopilotChatView）
  autoScroll={true}
  onSubmitMessage={(value) => { ... }}
  onStop={() => { ... }}
  welcomeScreen={true}            // boolean 或 SlotValue<FC<WelcomeScreenProps>>
/>
```

### v2 `CopilotChatProps` 完整接口

```ts
type CopilotChatProps = Omit<CopilotChatViewProps, 'messages' | 'isRunning' | ...> & {
  agentId?: string;
  threadId?: string;
  labels?: Partial<CopilotChatLabels>;
  chatView?: SlotValue<typeof CopilotChatView>;
  isModalDefaultOpen?: boolean;
  attachments?: AttachmentsConfig;
  onError?: (event: { error: Error; code: CopilotKitCoreErrorCode; context: Record<string, any> }) => void;
  throttleMs?: number;
};
```

### Labels 对比

| v1 Label Key | v2 Label Key | 默认值 |
|---|---|---|
| `title` | `modalHeaderTitle` | - |
| `placeholder` | `chatInputPlaceholder` | - |
| `initial` | `welcomeMessageText` | - |
| `error` | (通过 onError 处理) | - |
| `stopGenerating` | (内置) | - |
| `regenerateResponse` | `assistantMessageToolbarRegenerateLabel` | - |
| `copyToClipboard` | `assistantMessageToolbarCopyCodeLabel` | - |
| `thumbsUp` | `assistantMessageToolbarThumbsUpLabel` | - |
| `thumbsDown` | `assistantMessageToolbarThumbsDownLabel` | - |
| `copied` | `assistantMessageToolbarCopyCodeCopiedLabel` | - |
| (不存在) | `chatInputToolbarStartTranscribeButtonLabel` | 新增 |
| (不存在) | `chatInputToolbarCancelTranscribeButtonLabel` | 新增 |
| (不存在) | `chatInputToolbarFinishTranscribeButtonLabel` | 新增 |
| (不存在) | `chatInputToolbarAddButtonLabel` | 新增 |
| (不存在) | `chatInputToolbarToolsButtonLabel` | 新增 |
| (不存在) | `assistantMessageToolbarCopyMessageLabel` | 新增 |
| (不存在) | `assistantMessageToolbarReadAloudLabel` | 新增 |
| (不存在) | `userMessageToolbarCopyMessageLabel` | 新增 |
| (不存在) | `userMessageToolbarEditMessageLabel` | 新增 |
| (不存在) | `chatDisclaimerText` | 新增 |
| (不存在) | `chatToggleOpenLabel` | 新增 |
| (不存在) | `chatToggleCloseLabel` | 新增 |

### 被删除的 CopilotChat Props（v1 -> v2）

| v1 Prop | v2 替代方案 |
|---|---|
| `instructions` | 在 Agent 端配置 system prompt |
| `suggestions` | `useConfigureSuggestions` + `useSuggestions` |
| `makeSystemMessage` | Agent 端处理 |
| `disableSystemMessage` | Agent 端处理 |
| `onInProgress` | `useAgent().agent.isRunning` |
| `onStopGeneration` | `useAgent().agent.abortRun()` |
| `onReloadMessages` | 通过 CopilotChatAssistantMessage `onRegenerate` slot |
| `onRegenerate` | CopilotChatAssistantMessage `onRegenerate` slot |
| `onCopy` | CopilotChatAssistantMessage `onCopy` 已内置 |
| `onThumbsUp` / `onThumbsDown` | CopilotChatAssistantMessage `onThumbsUp` / `onThumbsDown` slot |
| `icons` | 通过 slots 自定义各个子组件 |
| `markdownTagRenderers` | CopilotChatAssistantMessage 的 `markdownRenderer` slot |
| `AssistantMessage` | `messageView` slot 的 `assistantMessage` sub-slot |
| `UserMessage` | `messageView` slot 的 `userMessage` sub-slot |
| `Messages` | `chatView` slot |
| `Input` | `input` slot |
| `RenderMessage` | `renderCustomMessages` (Provider 级) |
| `RenderSuggestionsList` | `suggestionView` slot |
| `ImageRenderer` | `CopilotChatAttachmentRenderer` 组件 |
| `imageUploadsEnabled` | `attachments: { enabled: true }` |
| `inputFileAccept` | `attachments: { accept: '...' }` |
| `hideStopButton` | CopilotChatInput 自定义 |
| `observabilityHooks` | Provider `onError` + `useAgent` subscriber |
| `renderError` | Provider `onError` 回调 |

---

## 5. CopilotSidebar / CopilotPopup 变更

### v1

```tsx
<CopilotSidebar
  defaultOpen={true}
  clickOutsideToClose={true}
  hitEscapeToClose={true}
  shortcut="/"
  onSetOpen={(open) => { ... }}
  Window={MyWindow}
  Button={MyButton}
  Header={MyHeader}
  {...copilotChatProps}
/>
```

### v2

```tsx
<CopilotSidebar
  defaultOpen={true}
  width={400}                   // 新增：宽度
  header={headerSlot}           // SlotValue<CopilotModalHeader>
  toggleButton={toggleSlot}     // SlotValue<CopilotChatToggleButton>
  {...copilotChatProps}         // 继承 CopilotChatProps（不含 chatView）
/>

<CopilotPopup
  defaultOpen={true}
  width={400}
  height={600}
  clickOutsideToClose={true}
  header={headerSlot}
  toggleButton={toggleSlot}
  {...copilotChatProps}
/>
```

**被删除的 Props**: `hitEscapeToClose`, `shortcut`, `onSetOpen`, `Window`, `Button`, `Header` (替换为 `header` slot + `toggleButton` slot)

---

## 6. 消息组件变更

### v2 Slot 架构

v2 使用 "Slot" 模式替代 v1 的 Component props。每个 slot 接受三种值：

```ts
type SlotValue<C extends React.ComponentType<any>> =
  | C                              // 1. 完整替换组件
  | string                         // 2. CSS class name
  | Partial<React.ComponentProps<C>> // 3. 覆盖部分 props
```

### CopilotChatAssistantMessage

**v1**: 通过 `AssistantMessage` prop 传入自定义组件

**v2**: `CopilotChatAssistantMessage` 是一个内置组件，通过 slots 自定义：

```tsx
import { CopilotChatAssistantMessage } from '@copilotkit/react-core/v2';

// 子组件 slots:
CopilotChatAssistantMessage.MarkdownRenderer  // 自定义 markdown 渲染（使用 Streamdown）
CopilotChatAssistantMessage.Toolbar           // 工具栏容器
CopilotChatAssistantMessage.CopyButton        // 复制按钮
CopilotChatAssistantMessage.ThumbsUpButton    // 点赞
CopilotChatAssistantMessage.ThumbsDownButton  // 踩
CopilotChatAssistantMessage.ReadAloudButton   // 朗读
CopilotChatAssistantMessage.RegenerateButton  // 重新生成

// Props:
interface CopilotChatAssistantMessageProps {
  message: AssistantMessage;       // AG-UI AssistantMessage
  messages?: Message[];
  isRunning?: boolean;
  onThumbsUp?: (msg) => void;
  onThumbsDown?: (msg) => void;
  onReadAloud?: (msg) => void;
  onRegenerate?: (msg) => void;
  additionalToolbarItems?: ReactNode;
  toolbarVisible?: boolean;
  // slots: markdownRenderer, toolbar, copyButton, thumbsUpButton, ...
  // + toolCallsView slot
}
```

### CopilotChatUserMessage

```tsx
CopilotChatUserMessage.MessageRenderer  // 消息内容
CopilotChatUserMessage.Toolbar          // 工具栏
CopilotChatUserMessage.CopyButton      // 复制
CopilotChatUserMessage.EditButton       // 编辑
CopilotChatUserMessage.BranchNavigation // 分支导航

// Props:
interface CopilotChatUserMessageProps {
  message: UserMessage;
  onEditMessage?: (props) => void;
  onSwitchToBranch?: (props) => void;
  branchIndex?: number;
  numberOfBranches?: number;
  additionalToolbarItems?: ReactNode;
}
```

### CopilotChatReasoningMessage（v2 新增）

v1 没有 reasoning 消息。v2 新增：

```tsx
CopilotChatReasoningMessage.Header   // 可折叠标题栏
CopilotChatReasoningMessage.Content  // 推理内容
CopilotChatReasoningMessage.Toggle   // 展开/折叠控制

// Props:
interface CopilotChatReasoningMessageProps {
  message: ReasoningMessage;
  messages?: Message[];
  isRunning?: boolean;
}
```

### CopilotChatView 组件层级

```
CopilotChat
  └── CopilotChatView
        ├── CopilotChatView.ScrollView          // 滚动容器
        │     ├── ScrollToBottomButton
        │     └── Feather
        ├── CopilotChatView.WelcomeScreen       // 欢迎界面
        │     └── WelcomeMessage
        ├── CopilotChatMessageView              // 消息列表
        │     ├── CopilotChatAssistantMessage
        │     ├── CopilotChatUserMessage
        │     ├── CopilotChatReasoningMessage
        │     └── Cursor
        ├── CopilotChatSuggestionView           // 建议列表
        │     └── CopilotChatSuggestionPill
        └── CopilotChatInput                    // 输入框
              ├── TextArea
              ├── SendButton
              ├── StartTranscribeButton
              ├── CancelTranscribeButton
              ├── FinishTranscribeButton
              ├── AddMenuButton
              ├── AudioRecorder
              └── Disclaimer
```

---

## 7. CSS / 样式变更

### Import 变更

```tsx
// v1
import '@copilotkit/react-ui/styles.css';

// v2
import '@copilotkit/react-core/v2/index.css';
```

### CSS Custom Properties 变更

**v1 CSS Variables** (通过 `CopilotKitCSSProperties`):
```css
--copilot-kit-primary-color
--copilot-kit-contrast-color
--copilot-kit-background-color
--copilot-kit-input-background-color
--copilot-kit-secondary-color
--copilot-kit-secondary-contrast-color
--copilot-kit-separator-color
--copilot-kit-muted-color
--copilot-kit-error-background
--copilot-kit-error-border
--copilot-kit-error-text
--copilot-kit-shadow-sm/md/lg
--copilot-kit-dev-console-bg/text
```

**v2 CSS Variables** (基于 Tailwind v4 `--cpk-*` 命名空间):
```css
/* 字体 */
--cpk-font-sans
--cpk-font-mono
--cpk-font-weight-normal/medium/semibold/bold

/* 文本尺寸 */
--cpk-text-xs/sm/base/xl/2xl (+ --line-height 后缀)

/* 间距 */
--cpk-spacing
--cpk-radius-2xl
--cpk-container-3xl

/* 颜色 — 色板体系 */
--cpk-color-white / --cpk-color-black
--cpk-color-gray-50/100/200/400/500/600/700/800/900
--cpk-color-zinc-50/100/200/300/400/500/700/800/900
--cpk-color-blue-500
--cpk-color-red-50/200/700
--cpk-color-emerald-100/400/500/800
--cpk-color-amber-100/400/500/800

/* 动画 */
--cpk-animate-pulse
--cpk-animate-pulse-cursor
--cpk-animate-spin

/* 其他 */
--cpk-leading-tight/relaxed
--cpk-tracking-tight/wide/widest
--cpk-ease-in-out / --cpk-ease-out
```

v2 CSS 使用 Tailwind v4 的 `@layer` 和 CSS-first 配置，不再依赖 v1 的简单变量覆盖。自定义主题需要通过覆盖 `--cpk-*` 变量或使用 Tailwind 配置。

---

## 8. v2 全新 API

### 8.1 `useRenderTool` — 纯渲染 Tool Call（v1 不存在）

不执行 handler，只渲染 tool call 的 UI：

```tsx
// 具名渲染器（带类型推导）
useRenderTool({
  name: 'searchDocs',
  parameters: z.object({ query: z.string() }),
  render: ({ status, parameters, result }) => {
    if (status === 'inProgress') return <div>准备中...</div>;
    if (status === 'executing') return <div>搜索 {parameters.query}...</div>;
    return <div>{result}</div>;
  },
  agentId: 'radar',  // 可选
}, []);

// 通配符渲染器（fallback）
useRenderTool({
  name: '*',
  render: ({ name, status }) => (
    <div>{status === 'complete' ? 'done' : 'running'} {name}</div>
  ),
}, []);
```

### 8.2 `useDefaultRenderTool` — 默认 Tool Call 卡片

```tsx
// 使用内置默认卡片
useDefaultRenderTool();

// 自定义默认渲染
useDefaultRenderTool({
  render: ({ name, status, parameters, result }) => (
    <ToolEventRow title={name} status={status} payload={result} />
  ),
}, [compactMode]);
```

### 8.3 `useComponent` — 便捷 Tool 渲染组件注册

```tsx
// 无参数 — render 接受 any props
useComponent({
  name: 'showGreeting',
  render: ({ message }: { message: string }) => <div>{message}</div>,
});

// 有参数 — render props 从 schema 推导
useComponent({
  name: 'showWeatherCard',
  parameters: z.object({ city: z.string() }),
  render: ({ city }) => <WeatherCard city={city} />,
  agentId: 'weather-agent',  // 可选
});
```

### 8.4 `useHumanInTheLoop` — HITL Tool

```tsx
useHumanInTheLoop({
  name: 'confirmAction',
  description: '让用户确认操作',
  parameters: z.object({
    action: z.string(),
    details: z.string(),
  }),
  render: ({ name, description, args, status, respond }) => {
    if (status === 'executing') {
      return (
        <div>
          <p>{args.details}</p>
          <button onClick={() => respond?.({ approved: true })}>批准</button>
          <button onClick={() => respond?.({ approved: false })}>拒绝</button>
        </div>
      );
    }
    return <div>已完成</div>;
  },
}, []);
```

**`ReactHumanInTheLoop` 接口**:
```ts
type ReactHumanInTheLoop<T extends Record<string, unknown>> = Omit<FrontendTool<T>, 'handler'> & {
  render: ComponentType<
    | { name; description; args: Partial<T>; status: 'inProgress'; result: undefined; respond: undefined }
    | { name; description; args: T; status: 'executing'; result: undefined; respond: (result: unknown) => Promise<void> }
    | { name; description; args: T; status: 'complete'; result: string; respond: undefined }
  >;
};
```

### 8.5 `useThreads` — 线程管理

```tsx
const {
  threads,              // Thread[]
  isLoading,
  error,
  hasMoreThreads,
  isFetchingMoreThreads,
  fetchMoreThreads,     // 分页加载
  renameThread,         // (threadId, name) => Promise<void>
  archiveThread,        // (threadId) => Promise<void>
  deleteThread,         // (threadId) => Promise<void>
} = useThreads({
  agentId: 'radar',
  includeArchived: false,
  limit: 20,
});
```

需要 CopilotKit Cloud / Intelligence Platform 支持。

### 8.6 `useAttachments` — 附件管理

```tsx
const {
  attachments,
  enabled,
  dragOver,
  fileInputRef,
  containerRef,
  processFiles,
  handleFileUpload,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  removeAttachment,
  consumeAttachments,
} = useAttachments({ config: { enabled: true, accept: 'image/*' } });
```

### 8.7 `defineToolCallRenderer` — 类型安全 Tool Renderer 定义

```tsx
import { defineToolCallRenderer } from '@copilotkit/react-core/v2';

// 具名
const searchRenderer = defineToolCallRenderer({
  name: 'searchDocs',
  args: z.object({ query: z.string() }),
  render: ({ name, args, status, result }) => <SearchCard {...args} status={status} />,
});

// 通配符
const wildcardRenderer = defineToolCallRenderer({
  name: '*',
  render: ({ name, status }) => <GenericToolCard name={name} status={status} />,
});

// 注册到 Provider
<CopilotKit renderToolCalls={[searchRenderer, wildcardRenderer]}>
```

### 8.8 `CopilotKitInspector` — 事件调试器

内置 AG-UI 事件检查器，可拖拽：

```tsx
// 通过 Provider prop 控制
<CopilotKit showDevConsole={true} inspectorDefaultAnchor={{ horizontal: 'right', vertical: 'top' }}>
```

### 8.9 `useSandboxFunctions` — 沙盒函数上下文

```tsx
const sandboxFunctions = useSandboxFunctions();
// 返回 readonly SandboxFunction[]
// 用于 OpenGenerativeUI 沙盒内函数调用
```

### 8.10 `MCPAppsActivityRenderer` — MCP 应用 Activity 渲染器

内置的 MCP 扩展 activity 渲染器，在沙盒 iframe 中渲染 MCP Apps UI：

```tsx
// 自动注册到 Provider，无需手动配置
// activityType = "mcp-apps"
```

### 8.11 `createA2UIMessageRenderer` — A2UI 消息渲染器工厂

```tsx
const renderer = createA2UIMessageRenderer({
  theme: myTheme,
  catalog: myCatalog,
  loadingComponent: MyLoader,
});
// 返回 ReactActivityMessageRenderer，注册到 Provider
```

---

## 9. AbstractAgent (`@ag-ui/client`)

v2 的核心是 `AbstractAgent`，由 `useAgent()` 返回。以下是完整 API：

### 属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `agentId` | `string?` | Agent 标识 |
| `description` | `string` | Agent 描述 |
| `threadId` | `string` | 当前线程 ID |
| `messages` | `Message[]` | 消息列表 |
| `state` | `State` | Agent 状态 |
| `isRunning` | `boolean` | 是否正在运行 |
| `subscribers` | `AgentSubscriber[]` | 订阅者列表 |
| `debug` | `ResolvedAgentDebugConfig` | 调试配置 |
| `debugLogger` | `DebugLogger?` | 调试日志 |
| `maxVersion` | `string` (getter) | 支持的最大协议版本 |

### 方法

| 方法 | 签名 | 说明 |
|------|------|------|
| `runAgent` | `(params?, subscriber?) => Promise<RunAgentResult>` | 执行 agent |
| `abortRun` | `() => void` | 中止当前执行 |
| `detachActiveRun` | `() => Promise<void>` | 分离活跃执行 |
| `setMessages` | `(messages: Message[]) => void` | 设置消息 |
| `addMessage` | `(message: Message) => void` | 添加单条消息 |
| `addMessages` | `(messages: Message[]) => void` | 添加多条消息 |
| `setState` | `(state: State) => void` | 设置状态 |
| `subscribe` | `(subscriber) => { unsubscribe }` | 订阅事件 |
| `use` | `(...middlewares) => this` | 注册中间件 |
| `clone` | `() => AbstractAgent` | 克隆 agent |
| `getCapabilities` | `() => Promise<AgentCapabilities>?` | 获取能力描述 |
| `connectAgent` | `(params?, subscriber?) => Promise<RunAgentResult>` | 连接并执行 |

### `RunAgentParameters`

```ts
type RunAgentParameters = Partial<Pick<RunAgentInput,
  'runId' | 'tools' | 'context' | 'forwardedProps'
>>;
```

### `AgentSubscriber` — 事件订阅接口

所有回调都可以返回 `AgentStateMutation | void`（同步或异步）：

```ts
interface AgentSubscriber {
  onRunInitialized?(params): void;
  onRunFailed?({ error, ...params }): void;
  onRunFinalized?(params): void;
  onEvent?({ event, ...params }): void;

  // 生命周期事件
  onRunStartedEvent?(): void;
  onRunFinishedEvent?({ result }): void;
  onRunErrorEvent?(): void;
  onStepStartedEvent?(): void;
  onStepFinishedEvent?(): void;

  // 文本消息事件
  onTextMessageStartEvent?(): void;
  onTextMessageContentEvent?({ textMessageBuffer }): void;
  onTextMessageEndEvent?({ textMessageBuffer }): void;

  // Tool 调用事件
  onToolCallStartEvent?(): void;
  onToolCallArgsEvent?({ toolCallBuffer, toolCallName, partialToolCallArgs }): void;
  onToolCallEndEvent?({ toolCallName, toolCallArgs }): void;
  onToolCallResultEvent?(): void;

  // 状态事件
  onStateSnapshotEvent?(): void;
  onStateDeltaEvent?(): void;
  onMessagesSnapshotEvent?(): void;

  // Activity 事件
  onActivitySnapshotEvent?({ activityMessage, existingMessage }): void;
  onActivityDeltaEvent?({ activityMessage }): void;

  // Reasoning 事件
  onReasoningStartEvent?(): void;
  onReasoningMessageStartEvent?(): void;
  onReasoningMessageContentEvent?({ reasoningMessageBuffer }): void;
  onReasoningMessageEndEvent?({ reasoningMessageBuffer }): void;
  onReasoningEndEvent?(): void;
  onReasoningEncryptedValueEvent?(): void;

  // Raw / Custom 事件
  onRawEvent?(): void;
  onCustomEvent?(): void;

  // 状态变更通知
  onMessagesChanged?(): void;
  onStateChanged?(): void;
  onNewMessage?({ message }): void;
  onNewToolCall?({ toolCall }): void;
}
```

### HttpAgent

```ts
const agent = new HttpAgent({
  url: '/api/agent/chat',
  headers: { Authorization: 'Bearer ...' },
  agentId: 'radar',
  threadId: 'thread-123',
  initialMessages: [],
  initialState: {},
  debug: true,
});
```

### Middleware

```ts
// 类方式
class LoggingMiddleware extends Middleware {
  run(input: RunAgentInput, next: AbstractAgent): Observable<BaseEvent> {
    return this.runNext(input, next).pipe(
      tap(event => console.log(event))
    );
  }
}

// 函数方式
agent.use((input, next) => {
  return next.run(input).pipe(
    filter(event => event.type !== 'CUSTOM')
  );
});

// 内置 middleware
agent.use(new FilterToolCallsMiddleware({
  allowedToolCalls: ['search', 'evaluate'],
}));
```

---

## 10. Streamdown 组件

v2 使用 `Streamdown` 替代 v1 的 `react-markdown` 来渲染 markdown。它专门为流式渲染优化。

### Props

```ts
interface StreamdownProps {
  children?: string;                        // markdown 内容
  mode?: 'static' | 'streaming';           // 渲染模式
  className?: string;
  components?: Components;                  // JSX 元素映射（同 react-markdown）
  rehypePlugins?: PluggableList;
  remarkPlugins?: PluggableList;
  remarkRehypeOptions?: Options;
  shikiTheme?: [BundledTheme, BundledTheme]; // [light, dark]
  mermaid?: MermaidOptions;                 // Mermaid 图表配置
  controls?: ControlsConfig;               // 控制按钮（表格/代码/Mermaid）
  isAnimating?: boolean;
  parseIncompleteMarkdown?: boolean;
  BlockComponent?: React.ComponentType<BlockProps>;
  parseMarkdownIntoBlocksFn?: (markdown: string) => string[];
}
```

### 关键特性

- **Block-based 渲染**: 将 markdown 按块解析和渲染，已完成的块不会被重新渲染
- **流式优化**: `mode: 'streaming'` 时，最后一个 block 随 token 增量渲染
- **Shiki 代码高亮**: 内置 Shiki，支持 light/dark 双主题
- **Mermaid 图表**: 内置 Mermaid 支持，可自定义错误组件
- **控制面板**: 代码块复制、表格操作、Mermaid 全屏/缩放

### 在 CopilotChatAssistantMessage 中的使用

```tsx
// v2 的 MarkdownRenderer 是 Streamdown 的封装：
CopilotChatAssistantMessage.MarkdownRenderer
// 等价于 <Streamdown>{content}</Streamdown> + 额外的 content prop

// 自定义 markdown 渲染
<CopilotChat
  // 通过 messageView -> assistantMessage -> markdownRenderer slot 链
  messageView={{
    assistantMessage: {
      markdownRenderer: {
        components: { code: MyCodeBlock },
        shikiTheme: ['github-light', 'github-dark'],
        controls: { code: true, table: true, mermaid: { fullscreen: true } },
      }
    }
  }}
/>
```

---

## 11. 逐步迁移清单

### Phase 1: Import 路径

- [ ] `@copilotkit/react-ui` -> `@copilotkit/react-core/v2`
- [ ] `@copilotkit/react-ui/styles.css` -> `@copilotkit/react-core/v2/index.css`
- [ ] 确认 `@ag-ui/core` 的类型直接从 `@copilotkit/react-core/v2` re-export

### Phase 2: Provider

- [ ] `CopilotKit` props 迁移（参考 Section 2 表格）
- [ ] 添加 `onError` 全局错误处理
- [ ] 可选：添加 `selfManagedAgents` 注册 HttpAgent

### Phase 3: Hooks

- [ ] `useCopilotReadable` -> `useAgentContext`（去掉 parentId、categories）
- [ ] `useCopilotAction` -> `useFrontendTool`（parameters 从 `Parameter[]` 改 Zod schema）
- [ ] `useCoAgent` -> `useAgent`（返回值从展开属性变为 `{ agent: AbstractAgent }`）
- [ ] `useCopilotChat` -> 通过 `useAgent().agent` 替代
- [ ] `useLangGraphInterrupt` -> `useInterrupt`
- [ ] `useCopilotChatSuggestions` -> `useConfigureSuggestions`
- [ ] `useCoAgentStateRender` -> `renderActivityMessages` 或 `useRenderTool`

### Phase 4: CopilotChat 组件

- [ ] 去掉 `instructions`, `makeSystemMessage` 等 props
- [ ] `labels` 结构迁移（对照 Section 4 表格）
- [ ] `icons` 删除，改用 slot 自定义
- [ ] `AssistantMessage`/`UserMessage` props 删除，改用 slot 模式
- [ ] `RenderMessage` 改用 `renderCustomMessages`
- [ ] 添加 `agentId` prop

### Phase 5: 新特性（可选）

- [ ] 接入 `useRenderTool` 渲染 tool call
- [ ] 接入 `useInterrupt` 处理 LangGraph 中断
- [ ] 接入 `useThreads` 线程管理
- [ ] 配置 `CopilotKitInspector` 开发调试
- [ ] 使用 `useComponent` 注册可视化组件

---

## 附录: Quick Reference

| v1 API | v2 API | 包路径 |
|--------|--------|--------|
| `import { CopilotKit } from '@copilotkit/react-core'` | `import { CopilotKit } from '@copilotkit/react-core/v2'` | `@copilotkit/react-core/v2` |
| `import { CopilotChat } from '@copilotkit/react-ui'` | `import { CopilotChat } from '@copilotkit/react-core/v2'` | `@copilotkit/react-core/v2` |
| `import '@copilotkit/react-ui/styles.css'` | `import '@copilotkit/react-core/v2/index.css'` | - |
| `useCopilotReadable()` | `useAgentContext()` | `@copilotkit/react-core/v2` |
| `useCopilotAction()` | `useFrontendTool()` | `@copilotkit/react-core/v2` |
| `useCoAgent()` | `useAgent()` | `@copilotkit/react-core/v2` |
| `useCopilotChat()` | `useAgent().agent.*` | `@copilotkit/react-core/v2` |
| `useLangGraphInterrupt()` | `useInterrupt()` | `@copilotkit/react-core/v2` |
| `useCopilotChatSuggestions()` | `useConfigureSuggestions()` | `@copilotkit/react-core/v2` |
| `useCoAgentStateRender()` | Provider `renderActivityMessages` | `@copilotkit/react-core/v2` |
| `useMakeCopilotDocumentReadable()` | `useAgentContext()` | `@copilotkit/react-core/v2` |
| `useCopilotAdditionalInstructions()` | (Agent 端处理) | - |
| (不存在) | `useRenderTool()` | `@copilotkit/react-core/v2` |
| (不存在) | `useDefaultRenderTool()` | `@copilotkit/react-core/v2` |
| (不存在) | `useComponent()` | `@copilotkit/react-core/v2` |
| (不存在) | `useHumanInTheLoop()` | `@copilotkit/react-core/v2` |
| (不存在) | `useThreads()` | `@copilotkit/react-core/v2` |
| (不存在) | `useSuggestions()` | `@copilotkit/react-core/v2` |
| (不存在) | `useAttachments()` | `@copilotkit/react-core/v2` |
| (不存在) | `useInterrupt()` | `@copilotkit/react-core/v2` |
| (不存在) | `defineToolCallRenderer()` | `@copilotkit/react-core/v2` |
| (不存在) | `createA2UIMessageRenderer()` | `@copilotkit/react-core/v2` |
