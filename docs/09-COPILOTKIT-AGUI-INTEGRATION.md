# CopilotKit + AG-UI + LangGraph 集成指南

> 基于官方示例项目调研，非猜测。
> 调研时间：2026-04-14

## 一、官方参考项目

| 项目 | 地址 | 说明 |
|------|------|------|
| **CopilotKit langgraph-fastapi** | https://github.com/CopilotKit/CopilotKit/tree/main/examples/integrations/langgraph-fastapi | **主参考**。单 Agent、FastAPI 直接 serve、Next.js BFF 中转 |
| CopilotKit langgraph-python (v2) | https://github.com/CopilotKit/CopilotKit/tree/main/examples/integrations/langgraph-python | v2 Runtime API（Hono-based），更新写法 |
| AG-UI LangGraph Python 集成 | https://github.com/ag-ui-protocol/ag-ui/tree/main/integrations/langgraph/python | 多 Agent Dojo 示例 |
| AG-UI server-starter-all-features | https://github.com/ag-ui-protocol/ag-ui/tree/main/integrations/server-starter-all-features/python | 纯 AG-UI（无 CopilotKit）的 Python 服务端 |
| CopilotKit Python SDK | https://github.com/CopilotKit/CopilotKit/tree/main/sdk-python/copilotkit | `copilotkit` Python 包源码 |

## 二、架构层级（从官方示例提炼）

```
前端 CopilotKit
  <CopilotKit runtimeUrl="/api/copilotkit" agent="radar">
    ↓ 内部调 POST /api/copilotkit (method: "agent/run")
Next.js BFF
  CopilotRuntime({ agents: { radar: new LangGraphHttpAgent({ url }) } })
  ExperimentalEmptyAdapter()
  copilotRuntimeNextJSAppRouterEndpoint()
    ↓ AG-UI POST + SSE (注入 copilotkit state)
Python FastAPI
  add_langgraph_fastapi_endpoint(app, LangGraphAGUIAgent(...), path="/agent/chat")
    ↓ LangGraph astream_events → AG-UI events
LangGraph Agent
  CopilotKitState 基类 + create_react_agent / StateGraph
  Tools (evaluate, web_search, github_stats, search_items)
```

## 三、每层的完整配置

### 3.1 Python 端

**依赖** (`pyproject.toml`):
```toml
dependencies = [
    "copilotkit>=0.1.74",        # CopilotKit Python SDK (含 LangGraphAGUIAgent, CopilotKitState)
    "langgraph>=0.4",            # LangGraph agent runtime
    "langchain>=0.3",            # LLM 抽象层
    "langchain-openai>=0.2",     # OpenAI-compatible provider
    "ag-ui-langgraph>=0.0.22",   # AG-UI ↔ LangGraph 桥接
    "fastapi>=0.115",            # HTTP 服务
    "uvicorn[standard]>=0.32",   # ASGI server
]
```

**Agent 定义** (`agent.py`):
```python
# 关键：用 copilotkit 的 CopilotKitState，不是自定义 state
from copilotkit import CopilotKitState
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import MemorySaver

class AgentState(CopilotKitState):
    """继承 CopilotKitState，获得 copilotkit actions 注入能力"""
    pass

graph = create_react_agent(
    model=llm,
    tools=tools,
    state_schema=AgentState,
    checkpointer=MemorySaver(),  # 必须！ag-ui-langgraph 需要 checkpointer
)
```

**Endpoint 注册** (`main.py`):
```python
# 关键：用 copilotkit 的 LangGraphAGUIAgent，不是 ag_ui_langgraph 的 LangGraphAgent
from copilotkit import LangGraphAGUIAgent
from ag_ui_langgraph import add_langgraph_fastapi_endpoint

agent = LangGraphAGUIAgent(
    name="radar",
    description="Radar content curation agent",
    graph=graph,
)

add_langgraph_fastapi_endpoint(app, agent, path="/agent/chat")
```

**区分两个 Agent 类**:

| 类 | 包 | 用途 |
|----|----|----|
| `LangGraphAGUIAgent` | `copilotkit` (Python SDK) | **用这个**。支持 CopilotKit state 注入（前端工具、共享状态） |
| `LangGraphAgent` | `ag_ui_langgraph` | 纯 AG-UI，不支持 CopilotKit 特性 |

### 3.2 Next.js BFF 端

**依赖** (`package.json`):
```json
{
  "@copilotkit/react-core": "^1.55.3",
  "@copilotkit/react-ui": "^1.55.3",
  "@copilotkit/runtime": "^1.55.3"
}
```

**API Route** (`src/app/api/agent/chat/route.ts`):
```typescript
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphHttpAgent } from "@copilotkit/runtime/langgraph";

// ⚠️ 必须 nodejs runtime，CopilotKit Runtime 依赖 Node.js http 模块
// ⚠️ 不能用 getEnv()（那是 Cloudflare Edge 的），用 process.env
export const runtime = 'nodejs';

const serviceAdapter = new ExperimentalEmptyAdapter();

const copilotRuntime = new CopilotRuntime({
  // ⚠️ 用 agents（不是 remoteEndpoints！remoteEndpoints 在 v1.55 不产生 agent 注册）
  agents: {
    radar: new LangGraphHttpAgent({
      url: process.env.RADAR_AGENT_BASE || "http://localhost:8001",
    }),
  },
});

export async function POST(req: Request) {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime: copilotRuntime,
    serviceAdapter,
    endpoint: "/api/agent/chat",
  });
  return handleRequest(req);
}
```

**关键 import 路径**:

| 导入 | 来源 |
|------|------|
| `CopilotRuntime` | `@copilotkit/runtime` |
| `ExperimentalEmptyAdapter` | `@copilotkit/runtime` |
| `copilotRuntimeNextJSAppRouterEndpoint` | `@copilotkit/runtime` |
| `LangGraphHttpAgent` | `@copilotkit/runtime/langgraph` ← **注意子路径** |

### 3.3 前端

**Provider 配置**:
```tsx
import { CopilotKit } from "@copilotkit/react-core";

// ⚠️ runtimeUrl 指向 BFF，不直连 Python
// ⚠️ agent 名必须和 BFF agents map 的 key + Python 的 name 一致
<CopilotKit runtimeUrl="/api/agent/chat" agent="radar">
  <AgentViewInner />
</CopilotKit>
```

**不需要**:
- `agents__unsafe_dev_only`（那是开发绕过用的）
- `HttpAgent` from `@ag-ui/client`（那是直连模式，绕过 CopilotKit Runtime）
- `selfManagedAgents`

## 四、我们之前的错误和纠正

| # | 错误 | 原因 | 纠正 |
|---|------|------|------|
| 1 | 用 `remoteEndpoints` 注册 agent | 从文档猜测 | 用 `agents` map + `LangGraphHttpAgent` |
| 2 | 用 `LangGraphAgent` (ag_ui_langgraph) | 不知道 copilotkit Python SDK 有专门的类 | 用 `LangGraphAGUIAgent` (copilotkit) |
| 3 | 用 `EmptyAdapter` | 过时 API | 用 `ExperimentalEmptyAdapter` |
| 4 | 用 Edge runtime | CopilotKit Runtime 依赖 Node.js http | 用 `nodejs` runtime + `process.env` |
| 5 | 用 `getEnv()` 读环境变量 | Cloudflare Edge 专用 | 用 `process.env` |
| 6 | 用 `agents__unsafe_dev_only` 直连 | 开发绕过，非正式方案 | 走 CopilotKit Runtime 标准链路 |
| 7 | 没有 `CopilotKitState` | 不知道需要 | Agent state 继承 `CopilotKitState` |
| 8 | 没有 `copilotkit` Python SDK | 不知道存在 | 安装 `copilotkit>=0.1.74` |

## 五、Agent 名称三处必须一致

```
Python:  LangGraphAGUIAgent(name="radar", ...)
BFF:     agents: { radar: new LangGraphHttpAgent(...) }
前端:    <CopilotKit agent="radar">
```

三处的 `"radar"` 必须完全一致，否则 CopilotKit 找不到 agent。

## 六、CopilotKit Runtime 的 /info 机制

前端 mount 时自动调用：
```
GET /api/agent/chat/info
或
POST /api/agent/chat  body: { method: "info" }
```

CopilotKit Runtime 返回：
```json
{
  "agents": {
    "radar": {
      "name": "radar",
      "description": "...",
      "className": "BuiltInAgent"
    }
  }
}
```

前端从 `/info` 响应中发现 agents，后续对话走：
```
POST /api/agent/chat  body: { method: "agent/run", params: { agentId: "radar" }, body: { messages: [...] } }
```

## 七、LangGraphHttpAgent 的工作方式

`LangGraphHttpAgent` 不是直接调 AG-UI endpoint。它调的是 Python 服务根路径，由 `add_langgraph_fastapi_endpoint` 注册的路由处理。

```
LangGraphHttpAgent({ url: "http://localhost:8001" })
  → POST http://localhost:8001/agent/chat
  → add_langgraph_fastapi_endpoint 处理
  → LangGraphAGUIAgent.run()
  → graph.astream_events() → AG-UI SSE events
```

## 八、需要的改动清单

| 文件 | 改动 |
|------|------|
| `agents/radar/pyproject.toml` | 加 `copilotkit>=0.1.74` |
| `agents/radar/src/radar/agent.py` | state 改为继承 `CopilotKitState`，import `from copilotkit import CopilotKitState` |
| `agents/radar/src/radar/main.py` | `LangGraphAgent` → `LangGraphAGUIAgent` (from copilotkit) |
| `apps/web/src/app/api/agent/chat/route.ts` | 用 `CopilotRuntime` + `LangGraphHttpAgent` + `ExperimentalEmptyAdapter`，nodejs runtime |
| `AgentView.tsx` | 去掉 `HttpAgent` / `agents__unsafe_dev_only` / `@ag-ui/client`，只保留 `runtimeUrl` + `agent` |

## 九、参考文档

| 文档 | 地址 |
|------|------|
| CopilotKit 文档 | https://docs.copilotkit.ai |
| CopilotKit Python SDK | https://docs.copilotkit.ai/coagents/quickstart/langgraph-python |
| AG-UI Protocol 文档 | https://docs.ag-ui.com |
| AG-UI Python SDK (ag-ui-protocol) | https://pypi.org/project/ag-ui-protocol |
| AG-UI LangGraph 适配器 (ag-ui-langgraph) | https://pypi.org/project/ag-ui-langgraph |
| LangGraph 文档 | https://langchain-ai.github.io/langgraph |
| CopilotKit GitHub | https://github.com/CopilotKit/CopilotKit |
| AG-UI GitHub | https://github.com/ag-ui-protocol/ag-ui |
| 官方 langgraph-fastapi 示例 | https://github.com/CopilotKit/CopilotKit/tree/main/examples/integrations/langgraph-fastapi |
| CopilotKit Python SDK 源码 | https://github.com/CopilotKit/CopilotKit/tree/main/sdk-python/copilotkit |
