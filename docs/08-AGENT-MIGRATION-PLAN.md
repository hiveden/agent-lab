# Agent 架构迁移实施方案

> 创建时间：2026-04-14
> 更新时间：2026-04-14（修复测试机制 + 对齐官方示例）
> 参考项目：https://github.com/CopilotKit/CopilotKit/tree/main/examples/integrations/langgraph-fastapi
> 集成指南：[09-COPILOTKIT-AGUI-INTEGRATION.md](./09-COPILOTKIT-AGUI-INTEGRATION.md)

## 一、目标架构

```
CopilotKit (前端, agent="radar")
    ↕ CopilotKit 协议
Next.js BFF (CopilotRuntime + LangGraphHttpAgent, nodejs runtime)
    ↕ AG-UI SSE
Python Agent (LangGraphAGUIAgent + add_langgraph_fastapi_endpoint)
    ↕ LangGraph astream_events
LangGraph ReAct Agent (CopilotKitState + tools)
```

## 二、执行模式

### dev → review → 集成验证 三阶段

```
Step Orchestrator:
  ├─ Phase 1: Dev（写代码 + 单测）
  ├─ Phase 2: Review（代码审查，Plan 类型 agent，不能写代码）
  │     FAIL → 回 Dev 修复 → 再 Review
  └─ Phase 3: 集成验证（跨层 step 专属）
        启动实际服务 → curl / 浏览器验证连通性
        FAIL → 回 Dev 修复 → 重新集成验证
```

### 集成验证触发点

不是所有 step 都需要集成验证。只有**跨层 step** 需要：

| Step | 跨层？ | 集成验证方式 |
|------|--------|-------------|
| 2-5 (tools) | 否 | 单测够了 |
| 6 (tools 注册) | 否 | import 验证 |
| 7 (agent) | 否 | import 验证 |
| 8 (AG-UI endpoint) | **是 (Python→SSE)** | 启动 Python，curl POST，验证 AG-UI 事件流 |
| 9 (BFF route) | **是 (BFF→Python)** | 启动 Python+Next.js，curl BFF，验证 /info 返回 agents |
| 10+11 (CopilotKit) | **是 (前端→BFF→Python)** | 启动全栈，浏览器打开页面，验证 chat 输入能收到回复 |

## 三、当前状态

### 已完成且有效的 steps（不需要重做）

| Step | 状态 | 说明 |
|------|------|------|
| 1 | ✅ | 依赖安装（需补装 `copilotkit` Python SDK） |
| 2 | ✅ | evaluate tool (11 tests) |
| 3 | ✅ | web_search tool (6 tests) |
| 4 | ✅ | github_stats tool (4 tests) |
| 5 | ✅ | search_items tool (7 tests) |
| 6 | ✅ | tools/__init__.py |

### 需要重做的 steps（对齐官方示例）

| Step | 原因 |
|------|------|
| 1 补丁 | 加 `copilotkit>=0.1.74` Python 依赖 |
| 7 | agent.py: state 改为 `CopilotKitState`，加 `checkpointer=MemorySaver()` |
| 8 | main.py: `LangGraphAgent` → `LangGraphAGUIAgent` (from copilotkit) |
| 9 | route.ts: 用 `CopilotRuntime` + `LangGraphHttpAgent`，nodejs runtime，process.env |
| 10+11 | AgentView.tsx: 去掉 `HttpAgent`/`agents__unsafe_dev_only`，只用 `runtimeUrl`+`agent` |

## 四、重做 Step 清单

### Step 1 补丁: 安装 copilotkit Python SDK

**产出**：`agents/radar/pyproject.toml` 加 `copilotkit>=0.1.74`，`uv sync`

**审查**：`uv sync` 零错误

---

### Step 7 重做: LangGraph Agent（对齐官方）

**产出**：修改 `agents/radar/src/radar/agent.py`

**实现要点**（参照官方 `langgraph-fastapi/agent/src/agent.py`）：
- state 继承 `CopilotKitState`（from copilotkit），不是自定义空 state
- `checkpointer=MemorySaver()`（必须，ag-ui-langgraph 需要）
- `create_react_agent(model, tools, state_schema=AgentState, checkpointer=...)`

**审查标准**：
- import `from copilotkit import CopilotKitState`
- state 类继承 `CopilotKitState`
- 有 `MemorySaver()` checkpointer
- 使用 `create_react_agent`，不手写 agent loop

---

### Step 8 重做: AG-UI Endpoint（对齐官方）

**产出**：修改 `agents/radar/src/radar/main.py`

**实现要点**（参照官方 `langgraph-fastapi/agent/serve.py`）：
- `from copilotkit import LangGraphAGUIAgent`（不是 `ag_ui_langgraph.LangGraphAgent`）
- `LangGraphAGUIAgent(name="radar", description="...", graph=graph)`
- `add_langgraph_fastapi_endpoint(app, agent, path="/agent/chat")`

**审查标准**：
- import 来自 `copilotkit`，不是 `ag_ui_langgraph`
- agent name 是 `"radar"`

**集成验证**：
```bash
# 启动 Python
cd agents/radar && uv run radar-serve &
sleep 3
# curl 测试
curl -s -X POST http://127.0.0.1:8001/agent/chat \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  --noproxy '*' \
  -d '{"messages":[{"role":"user","content":"你好"}],"thread_id":"test","run_id":"test-run"}' \
  --max-time 30 | head -20
# 必须看到: data: {"type":"RUN_STARTED",...}
kill %1
```

---

### Step 9 重做: BFF Route（对齐官方）

**产出**：修改 `apps/web/src/app/api/agent/chat/route.ts`

**实现要点**（参照官方 `langgraph-fastapi/frontend/src/app/api/copilotkit/route.ts`）：
```typescript
import { CopilotRuntime, ExperimentalEmptyAdapter, copilotRuntimeNextJSAppRouterEndpoint } from "@copilotkit/runtime";
import { LangGraphHttpAgent } from "@copilotkit/runtime/langgraph";

export const runtime = 'nodejs';  // 不是 edge

const copilotRuntime = new CopilotRuntime({
  agents: {   // 不是 remoteEndpoints
    radar: new LangGraphHttpAgent({
      url: process.env.RADAR_AGENT_BASE || "http://localhost:8001",
    }),
  },
});

export async function POST(req: Request) {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime: copilotRuntime,
    serviceAdapter: new ExperimentalEmptyAdapter(),
    endpoint: "/api/agent/chat",
  });
  return handleRequest(req);
}
```

**审查标准**：
- `nodejs` runtime
- `agents` map（不是 `remoteEndpoints`）
- `LangGraphHttpAgent`（不是 `HttpAgent`/`EmptyAdapter`）
- `ExperimentalEmptyAdapter`（不是 `EmptyAdapter`）
- `process.env`（不是 `getEnv()`）

**集成验证**：
```bash
# Python + Next.js 都启动
# curl BFF 的 /info
curl -s -X POST http://127.0.0.1:8788/api/agent/chat \
  -H "Content-Type: application/json" \
  -d '{"method":"info"}' | python3 -m json.tool
# 必须看到: {"agents":{"radar":{...}}}
```

---

### Step 10+11 重做: CopilotKit 前端（对齐官方）

**产出**：修改 `AgentView.tsx`

**实现要点**（参照官方 `langgraph-fastapi/frontend/src/app/layout.tsx`）：
```tsx
// 只需要这两个 props，不需要其他
<CopilotKit runtimeUrl="/api/agent/chat" agent="radar">
```

去掉：
- `import { HttpAgent } from '@ag-ui/client'`
- `agents__unsafe_dev_only`
- 模块级 `radarAgent` 常量

**审查标准**：
- 无 `HttpAgent` import
- 无 `agents__unsafe_dev_only`
- 无 `@ag-ui/client` import
- CopilotKit 只有 `runtimeUrl` + `agent` 两个 props

**集成验证（全栈）**：
```
1. 启动 Python (8001) + Next.js (8788)
2. 浏览器打开 http://127.0.0.1:8788/agents/radar
3. 控制台无 "Agent not found" 错误
4. 在 CopilotChat 输入 "你好"
5. 收到 LLM 回复
```

---

## 五、并行策略

```
Step 1 补丁（立即）
    ↓
Step 7+8 重做（串行，Python 侧）
    ↓ 集成验证：curl AG-UI endpoint
Step 9 重做（BFF 侧）
    ↓ 集成验证：curl /info 返回 agents
Step 10+11 重做（前端侧）
    ↓ 集成验证：浏览器全栈联调
Step 12+13（如果之前的代码仍兼容则不需要重做）
    ↓
最终验收
```

## 六、端到端验收

同之前的 5 个维度：功能 / 架构合规 / 回归 / 容错 / 流式体验。
详见本文件的旧版本。

## 七、教训

### 测试机制的缺陷和修复

| 缺陷 | 后果 | 修复 |
|------|------|------|
| review 只做 grep 审计和 TS 编译 | 集成问题到最后才暴露 | 跨层 step 加集成验证 |
| 没有参照官方示例 | 猜错了 CopilotKit 的连接方式 | 必须先找 working example |
| 所有验收攒到最后 | 错误积累 5 个 step 才发现 | 每个跨层节点立即验证 |
