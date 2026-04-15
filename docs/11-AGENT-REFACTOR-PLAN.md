# Agent 链路重构方案

> 基于 CopilotKit v1.55.3 + LangGraph + AG-UI Protocol 的 Agent 对话链路重构

## 一、当前问题

### 1.1 两套对话链路并存

```
链路 A (旧): InboxView ChatView
  → POST /api/chat (BFF, Edge Runtime)
  → Vercel AI SDK streamText() + TS tools (web_search, github_stats, search_items)
  → BFF 侧 LLM 推理 ← 违反 "BFF 不做推理" 原则
  → D1 持久化 chat_sessions/chat_messages ✅

链路 B (新): AgentView CopilotChat
  → POST /api/agent/chat (BFF, Node Runtime)
  → CopilotRuntime → LangGraphHttpAgent → Python ReAct Agent
  → Python 侧 LLM 推理 ✅
  → 无持久化 ❌ (MemorySaver 内存)
```

**问题**: 同样的 tool (web_search/github_stats/search_items) 维护了 TS + Python 两套实现。

### 1.2 CopilotKit 只接了表层

| 能力 | 状态 |
|------|------|
| `<CopilotChat>` 基础对话 | ✅ 已接 |
| `useCoAgent` 共享 state | ❌ 未接 — Agent tab 空 |
| `useCopilotAction` 前端 tool | ❌ 未接 — FrontendTools tab 空 |
| `useCopilotReadable` 上下文注入 | ❌ 未接 — Context tab 空 |
| `copilotkit_emit_state` Python 状态推送 | ❌ 未接 |
| `useCopilotChatInternal` 内部 API | ⚠️ 在用，升级风险 |

### 1.3 代码残留

| 残留 | 位置 | 状态 |
|------|------|------|
| TS tool 实现 (3个) | `apps/web/src/lib/tools/` | 只有链路 A 在用 |
| `/api/chat` route | `apps/web/src/app/api/chat/route.ts` | 链路 A 专用 |
| `/api/chat/sessions/[itemId]` | 同上 | 链路 A 专用 |
| `chains/chat.py` | `agents/radar/src/radar/chains/chat.py` | 仅被已废弃的 `/v1/chat/completions` 引用 |
| `/v1/chat/completions` | `agents/radar/src/radar/main.py` | 标记 DEPRECATED，前端零调用 |

### 1.4 运行时问题

| 问题 | 影响 |
|------|------|
| LLM 启动时冻结 | `create_radar_agent()` 在 import 时执行，Settings UI 改配置不生效 |
| evaluate tool external_id 匹配 | `split("-")[1]` 假设 ID 不含 `-`，扩展 source 时会炸 |
| AgentView 不用 Zustand store | 与 InboxView 完全割裂，状态不互通 |

---

## 二、技术选型评估

### 2.1 CopilotKit 是否保留？

| 维度 | 评估 |
|------|------|
| **核心价值** | AG-UI 协议封装、`useCoAgent` 前后端 state 同步、`useCopilotAction` 前端 tool 注册 |
| **替代成本** | 用裸 `@ag-ui/client` + 自写 Chat UI 替代：SSE 解析、消息渲染、tool call 展示全部自建，≈2 周 |
| **风险** | `useCopilotChatInternal` 内部 API、文档稀疏、Dev Console 功能不完善 |
| **生态** | 活跃维护中，AG-UI 是开放标准，不完全锁定 |

**结论: 保留 CopilotKit，但深度使用而非仅表层接入。** 如果后续 CopilotKit 发展不及预期，因为底层是标准 AG-UI 协议，可以低成本替换前端层。

### 2.2 对话 UI 方案

| 方案 | 描述 | 取舍 |
|------|------|------|
| A. `CopilotChat` 组件 | 开箱即用的完整 Chat UI | 样式定制受限，但可通过 slots 自定义 |
| B. Headless hooks + 自建 UI | 用 `useCopilotChat` + 自己渲染消息 | 完全控制 UI，但要自己处理消息渲染和流式显示 |
| C. 混合 | `CopilotChat` 做主体，自定义 tool call 渲染和 trace 面板 | 平衡控制力和开发速度 |

**结论: 方案 C。** 用 `CopilotChat` 处理基础消息收发和流式渲染，通过 `useCoAgentStateRender` 自定义 tool 执行过程的可视化，保留现有的 TraceDrawer。

### 2.3 状态管理方案

| 方案 | 描述 |
|------|------|
| A. Zustand only | AgentView 也接入 Zustand store |
| B. CopilotKit only | InboxView 也用 CopilotKit hooks |
| C. 分层 | CopilotKit 管 agent 对话 state，Zustand 管 UI state (filter, view, layout) |

**结论: 方案 C。** CopilotKit 的 `useCoAgent` 管 agent 运行时状态，Zustand 继续管 UI 层状态 (activeView, filter, selectedId, traceOpen, pending)。两层通过 `useCopilotReadable` 桥接——Zustand 的 selectedItem 作为 context 注入给 agent。

---

## 三、目标架构

```
┌─────────────────────────────────────────────────────────────┐
│ Frontend                                                     │
│                                                              │
│  CopilotKit Provider (runtimeUrl="/api/agent/chat")          │
│    ├─ useCoAgent("radar") ← agent state 同步                │
│    ├─ useCopilotReadable ← 注入 selectedItem 上下文         │
│    ├─ useCopilotAction ← 注册前端 tool (导航/标记)          │
│    ├─ CopilotChat ← 对话 UI                                 │
│    └─ useCoAgentStateRender ← 自定义 tool 进度渲染          │
│                                                              │
│  Zustand Store (UI state only)                               │
│    ├─ activeView, filter, selectedId                         │
│    ├─ pending (乐观更新)                                     │
│    └─ traceOpen, layout                                      │
│                                                              │
│  SWR Hooks (数据获取)                                        │
│    ├─ useItems() → /api/items                                │
│    └─ useRuns() → /api/runs                                  │
├──────────────────────────────────────────────────────────────┤
│ BFF (Next.js) — 纯数据层，零 LLM 推理                       │
│                                                              │
│  /api/agent/chat ← CopilotRuntime SSE 透传                  │
│  /api/items, /api/sources, /api/runs ← CRUD                 │
│  /api/cron/radar/* ← 触发 pipeline                          │
│  /api/settings ← LLM 配置                                   │
│                                                              │
│  删除: /api/chat, /api/chat/sessions, TS tools              │
├──────────────────────────────────────────────────────────────┤
│ Python Agent Server — 所有 LLM 推理                          │
│                                                              │
│  /agent/chat ← LangGraph ReAct Agent (AG-UI)                │
│    ├─ tools: web_search, github_stats, search_items, eval   │
│    ├─ copilotkit_emit_state() ← 推送进度                    │
│    └─ PlatformClient ← 持久化对话到 D1                      │
│  /ingest ← 采集 pipeline (SSE)                              │
│  /evaluate ← 评判 pipeline (SSE)                             │
│                                                              │
│  删除: /v1/chat/completions, chains/chat.py                 │
└──────────────────────────────────────────────────────────────┘
```

### 关键变化

| 维度 | 旧 | 新 |
|------|-----|-----|
| InboxView 对话 | BFF streamText + TS tools | CopilotKit → Python Agent |
| Item 上下文 | BFF system prompt 注入 | `useCopilotReadable` 前端注入 |
| 对话持久化 | BFF 侧 D1 写入 | Python Agent 通过 PlatformClient |
| Tool 实现 | TS + Python 两套 | Python 唯一 |
| Agent state | 无 | `useCoAgent` 双向同步 |
| 前端 tool | 无 | `useCopilotAction` (导航到 item, 标记状态) |

---

## 四、实现方案

### Phase 1: 修复与稳定（当前）

已完成:
- [x] 修复 URL 拼接 bug
- [x] 删除 MockChatModel 及整条 mock 链路

待做:
- [ ] **LLM 懒加载**: 创建 `DeferredLLM` wrapper，每次 invoke 时调 `get_llm()` 而非 graph 创建时
- [ ] **修复 evaluate external_id**: 用 raw_item.external_id → item.external_id 的完整映射替代 `split("-")[1]`
- [ ] **清理已废弃代码**: 删除 `chains/chat.py` + `/v1/chat/completions` 端点

### Phase 2: CopilotKit 深度集成（v1 API — 已完成）

目标: Agent 对话链路功能完整，Dev Console 四个 tab 全部有内容。

**已完成（v1 API）：**
- [x] useCoAgent("radar") — agent state 双向同步
- [x] useCopilotReadable — 注入 agent 配置偏好
- [x] useCopilotAction — show_notification / navigate_to_item / mark_item_status
- [x] useCoAgentStateRender — evaluate 进度渲染
- [x] copilotkit_emit_state — Python evaluate tool 进度推送
- [x] 对话持久化 — POST /api/chat/persist + PlatformClient + agui_tracing hook
- [x] 会话历史加载 — GET /api/chat/sessions?thread_id= + threadId localStorage
- [x] 会话列表 — GET /api/chat/sessions?agent_id= + 侧栏切换
- [x] AG-UI 事件去重 — agui_tracing.py 拦截重复 TOOL_CALL_START/TEXT_MESSAGE_START

**技术债（v1 遗留）：**
- useCopilotChatInternal（内部 API）— 公开 useCopilotChat 缺 messages/sendMessage
- as unknown as AGUIMessage[] 双重强转
- copilotkit_customize_config 跳过（prebuilt agent 不适用）

### Phase 2.5: Tailwind v4 升级 + CopilotKit v2 API 迁移

前置条件：Tailwind v3 → v4（v2 CSS 用 Tailwind v4 `@layer` 语法）

**Tailwind 升级：**
- tailwind.config.ts → CSS-in-config 模式
- postcss.config.mjs 调整
- globals.css @tailwind 指令改为 @import
- 验证所有现有页面不 break

**v2 API 迁移（基于 docs/COPILOTKIT-V2-MIGRATION.md）：**
- useAgent 替代 useCopilotChatInternal + useCoAgent（消除内部 API 技术债）
- useAgentContext 替代 useCopilotReadable
- useFrontendTool (Zod schema) 替代 useCopilotAction
- useRenderTool 通配符替代 RenderMessage prop
- v2 CSS (streamdown + --cpk-* 色板) + design tokens 覆盖
- streamdown 替代 react-markdown（解决 streaming markdown 闪烁）

**Python 端（不需要改）：**
- copilotkit_emit_state — 已完成
- 对话持久化 — 已完成
- copilotkit_customize_config — 跳过（prebuilt agent 不适用）

### Phase 3: 统一对话路径

目标: InboxView 的 ChatView 也走 Python Agent，删除 BFF 侧 LLM 推理。

```
1. InboxView ChatView 改用 CopilotKit:
   - 包裹 CopilotKit Provider
   - useCopilotReadable 注入当前 item 上下文
   - CopilotChat 替代 useChat

2. 删除旧链路:
   - apps/web/src/app/api/chat/route.ts
   - apps/web/src/app/api/chat/sessions/[itemId]/route.ts
   - apps/web/src/lib/tools/ (3 个 TS tool 文件)
   - apps/web/src/lib/tools/index.ts

3. 删除 Zustand SessionsSlice (对话历史改由 CopilotKit 管理)

4. 对话持久化迁移:
   - 旧: BFF 侧 insertMessage() → D1
   - 新: Python Agent → PlatformClient → /api/chat/sessions (新增写入端点)
```

### Phase 4: 清理

```
1. Python 端清理:
   - 删除 chains/chat.py
   - 删除 /v1/chat/completions 端点及相关 class (ChatMessage, ChatCompletionRequest)
   - 删除 main.py 的 _openai_sse_iter

2. 文档更新:
   - CLAUDE.md 移除过渡期描述
   - 更新 API 端点表
   - 更新数据流图

3. 依赖清理:
   - 评估是否可移除 apps/web 的 `ai` + `@ai-sdk/openai` 依赖
```

---

## 五、风险与决策点

| 决策 | 选择 | 理由 |
|------|------|------|
| `useCopilotChatInternal` | Phase 2 替换掉 | 改用 `useCoAgent` 获取 state，不再需要 internal hook 的 `messages` |
| 对话持久化方式 | Python Agent → PlatformClient | 与 "Agent Server 做所有逻辑" 一致，BFF 只提供写入 API |
| InboxView 迁移时机 | Phase 3 单独做 | Phase 2 先让 AgentView 完全可用，验证模式后再迁移 |
| TraceDrawer 保留 | 保留，数据源切换 | 从手动解析 AG-UI messages 改为从 `useCoAgent` state 获取 |
| CopilotKit 样式定制 | 用 CSS variables 覆盖 | CopilotChat 支持 className + CSS custom properties |

---

## 六、文件变更预览

### Phase 1 新增/修改
```
M agents/shared/src/agent_lab_shared/llm.py          — DeferredLLM wrapper
M agents/radar/src/radar/agent.py                     — 用 DeferredLLM
M agents/radar/src/radar/tools/evaluate.py            — 修复 external_id 匹配
D agents/radar/src/radar/chains/chat.py               — 删除
M agents/radar/src/radar/main.py                      — 删除 /v1/chat/completions
```

### Phase 2 新增/修改
```
M apps/web/src/app/agents/radar/components/production/AgentView.tsx
    — 重构: useCoAgent + useCopilotReadable + useCopilotAction
    — 删除: useCopilotChatInternal + 手动 AGUIMessage 类型
M agents/radar/src/radar/agent.py
    — 增加 copilotkit_emit_state
M agents/radar/src/radar/tools/evaluate.py
    — 增加 copilotkit_emit_state 进度推送
```

### Phase 3 新增/修改
```
M apps/web/src/app/agents/radar/components/consumption/ChatView.tsx
    — 改用 CopilotKit
D apps/web/src/app/api/chat/route.ts
D apps/web/src/app/api/chat/sessions/[itemId]/route.ts
D apps/web/src/lib/tools/web-search.ts
D apps/web/src/lib/tools/github-stats.ts
D apps/web/src/lib/tools/search-items.ts
D apps/web/src/lib/tools/index.ts
M apps/web/src/lib/stores/radar-store.ts              — 删除 SessionsSlice
```
