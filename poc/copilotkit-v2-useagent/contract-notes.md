# BFF `/api/agent/chat` Contract Notes

> Worker B · Phase B1
> 来源：`apps/web/src/app/api/agent/chat/route.ts` + `agents/radar/src/radar/main.py` + `apps/web/src/app/agents/radar/components/production/AgentView.tsx`
> CopilotKit 版本：`@copilotkit/{react-core,react-ui,runtime}@^1.56.2`（Desktop 已用 v2 namespace）

---

## 1. 请求（Browser → BFF）

- **Method**：`POST`
- **URL**：`/api/agent/chat`（浏览器侧 fetch 到同源 BFF）
- **实际实现**：`CopilotRuntime` + `copilotRuntimeNextJSAppRouterEndpoint`，Content-Type 由 CopilotKit runtime-client 控制（GraphQL + SSE streaming）。**PoC 不需要自己拼 request**——`<CopilotKit runtimeUrl="/api/agent/chat">` + `useAgent()` 全托管。
- **Headers**：
  - `content-type`: 由 runtime-client 决定
  - `traceparent` / `tracestate`：可选。浏览器 OTel `FetchInstrumentation` 自动注入（W3C propagation），`propagateTraceHeaderCorsUrls: [/.*/]` 已放行所有目标 URL。
  - 其它自定义 header：通过 `<CopilotKit headers={...}>` 注入（**必须传稳定引用**——见 §5 #32 教训）。
- **Body shape**：CopilotRuntime GraphQL payload（内部协议，非稳定 schema）。

## 2. 响应（BFF → Browser）

- **Content-Type**：`text/event-stream`（SSE）
- **实现**：`LangGraphHttpAgent` 把下游 Python `/agent/chat` 的 AG-UI SSE 流透传出来。BFF 层面**不做业务改写**，只是 CopilotRuntime 的 langgraph adapter 做 event 编解码。
- **AG-UI event 类型**（由 `ag-ui-langgraph` 产出，前端 `useAgent` 消费 → `messages[]` / `isRunning` / `state`）：
  - `RUN_STARTED` — run 开始，`isRunning → true`
  - `TEXT_MESSAGE_START` / `TEXT_MESSAGE_CONTENT` / `TEXT_MESSAGE_END` — assistant 流式 token
  - `TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_END` — tool calling（**V2 验证点**：`TOOL_CALL_ARGS` 在 tool 执行中增量到达）
  - `STATE_SNAPSHOT` / `STATE_DELTA` — LangGraph state 同步（`useAgent().state`）
  - `RUN_FINISHED` — `isRunning → false`
  - 具体格式见 ag-ui-protocol 官方文档；PoC 可在 Network tab 的 SSE viewer 抓实际 frame 印证。

## 3. Python 侧对接

- **FastAPI route**：`agents/radar/src/radar/main.py:87`
  ```python
  add_langgraph_fastapi_endpoint(app, ag_ui_agent, path="/agent/chat")
  ```
  由 `ag_ui_langgraph` 提供，不是手写 `@app.post`。
- **依赖版本**（`agents/radar/pyproject.toml`）：
  - `ag-ui-protocol>=0.1`
  - `ag-ui-langgraph>=0.0.30`
- **Agent 包装**：`TracingLangGraphAGUIAgent(name="radar", graph=create_radar_agent(checkpointer=saver))`，基于 `LangGraphAGUIAgent` + 自定义 OTel span 包装（见 `agui_tracing.py`）。
- **Trace context 接入**：
  - `FastAPIInstrumentor.instrument_app(app, exclude_spans=["send","receive"])`（`main.py:103`）——自动从入站 `traceparent` 提取 W3C context 到当前 OTel context。
  - `HTTPXClientInstrumentor().instrument()` 保证出站 propagation。
  - CORS 已显式允许 `allowed_headers=["content-type","authorization","traceparent","tracestate"]`（`main.py:127`）。
- **写入认证**：`/agent/chat` 路径**不**走 `_check_auth`（Bearer token 只保护 `/ingest` `/evaluate` `/test-collect` `/internal/*`）。PoC chat 流**无需额外 token**。

## 4. 当前 Desktop 用法（AgentView.tsx）

```tsx
import { CopilotKit } from '@copilotkit/react-core/v2';
import '@copilotkit/react-core/v2/styles.css';

const EMPTY_OBJ: Record<string, never> = {};  // 模块级稳定引用（#32 修复）

<CopilotKit
  key={threadId}                                   // threadId 变就重建 provider
  runtimeUrl="/api/agent/chat"
  showDevConsole={process.env.NODE_ENV === 'development'}
  agents__unsafe_dev_only={EMPTY_OBJ}              // 必传稳定 ref
  selfManagedAgents={EMPTY_OBJ}
  headers={EMPTY_OBJ}
  properties={EMPTY_OBJ}
>
  <SessionDetail threadId={threadId} ... />
</CopilotKit>
```

- `runtimeUrl` 固定 `/api/agent/chat`
- 无自定义 `headers` / `properties`（空对象是稳定 ref hack）
- 未传 `agentId`，走 BFF runtime 配置的 `default` → `radarAgent`（见 `route.ts:37`）

## 5. PoC 应匹配的最小契约

| 项 | 值 / 建议 |
|---|---|
| `runtimeUrl` | `/api/agent/chat`（PoC 项目 **dev 端口 ≠ 8788**，需要在 PoC 的 `next.config` 加 rewrite 把 `/api/agent/chat` → `http://127.0.0.1:8788/api/agent/chat`，或者直接 `runtimeUrl="http://127.0.0.1:8788/api/agent/chat"`） |
| `<CopilotKit>` props | `runtimeUrl` + `showDevConsole`（V6 验证用）；**其它 prop 可留空**——v2 useAgent 跑默认 agent |
| `useAgent()` | 不传 `agentId` → 命中 BFF runtime 的 `default` 映射 |
| 前端 npm deps | `@copilotkit/react-core@latest`（取 v2 subpath）、`@copilotkit/runtime-client-gql@latest`（v2 TS 客户端） |
| OTel | 走 B2 的 snippet，把 `NEXT_PUBLIC_OTEL_COLLECTOR_URL=http://localhost:4318` 指给 collector（CORS 已允许 8788；PoC 新端口可能被 collector CORS 挡，见下方坑） |

### 必坑清单（基于 #32 + docs/22 教训）

1. **CopilotKit v2 destructure 默认值 bug（#32 根因）**
   - 不传 `agents__unsafe_dev_only` / `selfManagedAgents` / `headers` / `properties` → provider 内 `= {}` 默认每次 render 新 ref → effect 重跑 → Inspector 清空。
   - **PoC 修法**：照抄 Desktop 的 `EMPTY_OBJ` 模块级常量。
   - **V6 验证点**：故意不传，观察 Dev Console Agent tab 是否确实清空（v2 官方可能已修复；V6 就是验证这个）。

2. **Dev Console 的观测局限（docs/22 #32 决策）**
   - Inspector 是 mount 后往后看的内存工具，切会话 / unmount 会清空。
   - PoC 的 V3/V4 trace 贯穿**不要**依赖 Dev Console，优先用 Langfuse (:3010) + SigNoz (:3301) + Python `/tmp/radar-dev*.log` grep。

3. **CORS 与跨端口**
   - 观测 collector CORS 允许的 origin 列表来自 `docker/observability/` 的 OTel Collector config（默认 `:8788`）。PoC 若跑 `:3000` / `:3001` 等别的端口，可能被 collector 挡 OPTIONS。
   - **解法**：(a) PoC 也跑 `:8788`（停 `pnpm dev:web`）；(b) 或改 collector CORS allowed_origins 增加 PoC 端口。

4. **Python `/agent/chat` 不做 auth**
   - PoC 直接跑 `radar-serve` + BFF `/api/agent/chat` → Python 即可，无需设 `RADAR_WRITE_TOKEN`。

5. **BFF runtime 需要跑**
   - PoC 依赖 `apps/web` 的 `/api/agent/chat` route。**两种选择**：
     - (A) PoC next app 内**复制** `apps/web/src/app/api/agent/chat/route.ts` + CopilotKit runtime 依赖 → 独立端口完整跑；
     - (B) PoC next app 只做前端，通过 absolute URL `runtimeUrl="http://127.0.0.1:8788/api/agent/chat"` 直连现有 BFF。需 CORS（Next dev server 跨端口默认不放 OPTIONS，要给 BFF 加 CORS 或在 PoC next.config rewrite 代理）。
   - **推荐 (A)**：PoC 完全自包含，避免跨端口 CORS/cookie 麻烦；代价是多装 `@copilotkit/runtime` + `langgraph` adapter。

6. **LangGraphHttpAgent URL**
   - BFF 把浏览器 SSE 转发到 `${RADAR_AGENT_BASE}/agent/chat`（默认 `http://localhost:8001`）。PoC 方案 (A) 要么复用这个 env，要么硬编码 `http://127.0.0.1:8001`。

7. **trace_id 验证（V3）**
   - 浏览器 OTel span 生成 traceparent → BFF Node OTel undici instrumentation auto-propagate → Python FastAPIInstrumentor 接收。三端同 trace_id。
   - ADR-002c 已说明 AG-UI `runId` ≠ OTel `trace_id`，PoC 的 V3 必须从**浏览器 OTel span** 读 trace_id（见 `otelTraceEvents` EventTarget），不要用 `runId`。
