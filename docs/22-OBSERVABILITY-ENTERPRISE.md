# 22 - 全栈企业级可观测性架构（v2）

> **日期**：2026-04-18
> **状态**：设计阶段
> **触发**：v1（`docs/12-OBSERVABILITY-ARCHITECTURE.md`）选型基于"个人项目"假设，与 agent-lab 实际定位"全栈企业级落地项目脚手架"不符。重新评估全部技术选型。
> **关系**：本文 **supersede** v1。v1 仅作历史保留，新工作以本文为准。
> **范围**：从浏览器到 LLM 调用的端到端可观测性，覆盖 trace / log / metric / error / eval / profile 六个维度。

---

## 目录

- [0. 元信息与决策框架](#0-元信息与决策框架)
- [1. 现状盘点](#1-现状盘点)
- [2. 架构总览](#2-架构总览)
- [3. 技术选型决策（10 个 ADR）](#3-技术选型决策10-个-adr)
- [4. 实施路线图](#4-实施路线图)
- [5. 已知风险与对策](#5-已知风险与对策)
- [6. 不做什么（明确边界）](#6-不做什么明确边界)
- [7. 附录：官方文档与最佳实践索引](#7-附录官方文档与最佳实践索引)

---

## 0. 元信息与决策框架

### 0.1 v1 → v2 演进的真实原因

v1 文档（2026-04-14 起草）的核心选型理由都是"个人项目"视角：

| v1 决策 | v1 理由 | v2 重新评估 |
|---|---|---|
| L3 选 LangSmith 而非 Langfuse | "Langfuse 需要自建服务，太重" | 自建多组件栈本身是企业级核心技能 |
| 排除 OpenTelemetry | "OTel 太重，对 LLM 场景支持弱" | OTel 是行业事实标准，所有大厂在它上面建栈 |
| 排除 Sentry | "单用户项目不需要错误聚合" | 企业级零容忍漏错，错误聚合必备 |
| 自定义 `agui_tracing.py` | "AG-UI 没有现成方案，需薄层拦截" | 既观测又 enforcement 的反模式，掩盖根因 |
| 缺前端 / BFF 可观测性 | 未提及 | 跨进程不可分割，前端缺失 = 端到端断链 |
| 缺 metrics / eval / profile 平面 | 未提及 | 企业级可观测性是六维而非三维 |

**触发本次重新评估的具体事件**：2026-04-18 排查 Agent chat 的 `duplicate_start_suppressed` warning 时，必须穿越 4 层（事件抓取 → 抑制逻辑审查 → 上游 LangGraph 追因 → 前端聚合验证）才能定位现象。这种排查复杂度暴露了 v1 选型的天花板：**没有端到端 trace_id 链路时，每次问题都是新的考古**。

### 0.2 决策原则（v2，企业级）

| 原则 | 含义 | 反例（v1 的做法） |
|---|---|---|
| **行业标准 over 省事** | 选 OTel + OpenInference + W3C Trace Context 等开放标准，避免供应商私有协议 | 直接用 LangSmith SDK 享受零代码集成 |
| **学习价值 over 短期成本** | 自托管多组件栈是企业级核心技能，"重"是负担也是练兵 | 拒绝自托管 Langfuse 因为 5 组件 |
| **可演进 over 一次到位** | 每个选型必须有"以后能换"的退路（数据可导出、协议标准化）| 自定义事件协议，迁移即重写 |
| **观测与修复分离** | 观测层不做 enforcement；修复必须给上游提 issue/PR | `agui_tracing` 既报警又抑制，掩盖根因 |
| **三平面分立** | 通用 trace/log/metric + LLM 专用 trace + Eval 是三个独立平面，靠 trace_id 关联 | 把全部寄希望于 LangSmith 一个工具 |
| **端到端 trace_id 贯穿** | 浏览器 → BFF → Python → LangGraph 同一 trace_id 必达 | 三段各有 ID，靠时间戳近似匹配 |
| **过程透明度优先** | 架构决策的推理路径要写明白，便于后续质疑和演进 | 选型理由一行带过 |

### 0.3 与项目目标的对齐

依据 `docs/02-ARCHITECTURE.md` 的演进路径：

```
Phase 1（当前）：单 Agent + LangGraph + AG-UI + CopilotKit
Phase 2（中期）：多 Agent 图编排 + checkpoint + HITL
Phase 3（远期）：自建编排层
```

可观测性架构是这条演进路径的**前置条件**：

- Phase 2 多 Agent → 没有跨 agent trace 关联，根本调不动
- Phase 3 自建编排 → 必须有标准化 instrumentation 接口，不能锁定第三方
- 学习目标"多 Agent 架构是核心"（CLAUDE.md）→ 必须经历完整 observability 栈的搭建与运维

---

## 1. 现状盘点

### 1.1 v1 已落地（保留）

| 组件 | 位置 | 状态 |
|---|---|---|
| **structlog** 结构化日志 | `agents/shared/src/agent_lab_shared/logging.py` | ✅ 在用，配 ConsoleRenderer / JSONRenderer 双模式 |
| **FastAPI request middleware** | `agents/radar/src/radar/middleware.py` | ✅ 在用，每 request 一个 `request_id` UUID |
| **`agui_tracing.py` 三层去重** | `agents/radar/src/radar/agui_tracing.py` | ⚠️ 在用但需重构（见 ADR-010） |
| **LangSmith SDK 配置** | `agents/shared/src/agent_lab_shared/config.py` | ⚠️ 代码就绪，`LANGSMITH_TRACING` 默认 false |
| **CopilotKit Dev Console** | `apps/web/src/app/agents/radar/components/production/AgentView.tsx` | ⚠️ 已知 bug：0 messages 计数（issue #3208 / #3039） |
| **自定义 Exception 体系** | `agents/radar/src/radar/exceptions.py` | ✅ 部分（`RadarError` 基类 + 子类） |

### 1.2 缺口（按企业级标准）

| 维度 | 缺口 | 影响 |
|---|---|---|
| **OTel SDK** | 三端（前端/BFF/Python）均无 OTel instrumentation | 跨进程无法 trace 关联 |
| **trace_id 透传** | 浏览器/BFF/Python 三段 ID 互不通 | 排查需要时间戳近似匹配 |
| **前端可观测性** | 无 trace、无错误聚合 | 用户视角问题黑盒 |
| **BFF 可观测性** | Cloudflare Pages 仅 dashboard tail，无持久化 | 历史日志不可查 |
| **LLM trace 后端** | LangSmith 没开 | LLM 调用全黑盒 |
| **Metrics 平面** | 无 | 容量规划、SLO 告警无法做 |
| **Eval 平面** | 无 | 模型质量回归不可监控 |
| **Profiling** | 无 | 性能瓶颈靠猜 |
| **错误聚合** | 无 Sentry/类似工具 | 错误漏报、无 source map |
| **日志持久化** | structlog 仅 stdout，CF Pages 仅 tail | 不能跨时间窗口 grep |

### 1.3 已知病灶（来自 17/19 文档）

> 这些是当前 chat 链路上已经定位但未修上游的问题，新方案必须能容纳/暴露/修复这些。

1. **`ag-ui-langgraph` adapter 重复 START 事件**
   - 现象：同一 `event_id` 的 `TOOL_CALL_START` / `TEXT_MESSAGE_START` 被发射两次
   - 根因：本地模型 streaming chunks 被 adapter 错误重发
   - v1 处理：`agui_tracing._dispatch_event` START 配对去重 + END 孤立去重
   - v2 处理：拆观测/修复 + 提 upstream issue（见 ADR-010）

2. **`DeferredLLM` 包装器导致 `on_chat_model_stream` 双重发射**
   - 现象：每个 token 重复一次（"最近最近有什么有什么"）
   - 根因：`DeferredLLM` 是 `BaseChatModel` 子类，LangGraph `astream_events` 捕获所有 BaseChatModel 节点事件
   - v1 处理：`agui_tracing` 连续 `(message_id, delta)` 去重
   - v2 处理：评估是否能换实现避免包装层（GenAI semconv 项目自定义 chat model 标准做法）

3. **CopilotKit Dev Console "0 messages / 0 tool calls"（200 events）**
   - 根因：CopilotKit 把 AG-UI event 转 `Message` 时丢弃 `rawEvent`（issue #3039）+ `lc_run--<uuid>` 作 message_id 状态机错乱（issue #3208 残留）
   - v2 影响：**不能依赖 CopilotKit Dev Console 做 observability UI**——本来也不是它的设计目标

---

## 2. 架构总览

### 2.1 三平面分立 + 一根 trace_id 串

```
┌─────────────────────────────────────────────────────────────────────┐
│                          用户 Browser                                │
│   crypto.randomUUID() → traceparent: 00-<traceId>-<spanId>-01       │
│   @opentelemetry/sdk-web + fetch instrumentation                    │
│   GlitchTip browser SDK（错误）                                       │
└─────────────────────────────────────────────────────────────────────┘
                                 │ traceparent header
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Next.js BFF (Cloudflare Pages Edge)                    │
│   otel-cf-workers + fetch-based OTLP exporter                       │
│   ctx.waitUntil(span.flush())                                       │
│   SSE passthrough，事件采样写日志                                     │
└─────────────────────────────────────────────────────────────────────┘
                                 │ traceparent header
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│         Python FastAPI + LangGraph + AG-UI                          │
│   opentelemetry-instrumentation-fastapi（含 streaming workaround）   │
│   OpenLLMetry LangChain auto-instrument                              │
│   LangGraph: config={"run_id": UUID(traceId), "callbacks": [...]}   │
│   structlog + OTel processor → trace_id 自动入每条 log               │
│   AG-UI BaseEvent.runId == traceId（不依赖 rawEvent）                │
└─────────────────────────────────────────────────────────────────────┘
                                 │ OTLP (gRPC + HTTP)
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  OTel Collector (Gateway 模式)                       │
│   receiver: OTLP gRPC + HTTP                                        │
│   processor: memory_limiter, batch, attributes (PII 脱敏)            │
│   exporter: 多目标分流                                                │
└─────────────────────────────────────────────────────────────────────┘
        │              │              │              │
        ▼              ▼              ▼              ▼
   ┌────────┐    ┌──────────┐    ┌─────────┐    ┌──────────┐
   │ SigNoz │    │ Langfuse │    │GlitchTip│    │Pyroscope │
   │ trace/ │    │ LLM专用   │    │ error   │    │profile   │
   │ log/   │    │ trace +  │    │ aggreg. │    │(可选)     │
   │ metric │    │ Eval     │    │         │    │          │
   └────────┘    └──────────┘    └─────────┘    └──────────┘
        │              │              │              │
        └──────────────┴──────┬───────┴──────────────┘
                              │
              所有平面共享同一个 trace_id（W3C 32-hex）
              排查时跨工具一键跳转
```

### 2.2 端到端 trace_id 链路（核心设计）

**统一 trace_id = LangChain `run_id` = AG-UI `BaseEvent.runId`**

这条等式来自调研发现：

- LangChain 官方文档明确 `run_id` 与 `trace_id` 等价（[trace-with-langchain](https://docs.langchain.com/langsmith/trace-with-langchain)）
- AG-UI `BaseEvent` 顶层字段含 `runId` + `threadId`，CopilotKit 17 种事件全继承（[AG-UI events docs](https://docs.ag-ui.com/concepts/events)）
- `BaseEvent.runId` 是顶层字段——CopilotKit `convertEventToMessage` 不会丢（绕开 #3039）

```
Step 1: 浏览器生成
    const traceId = crypto.randomUUID().replace(/-/g, '')  // 32-hex
    fetch('/api/agent/chat', {
      headers: { traceparent: `00-${traceId}-${spanId}-01` }
    })

Step 2: BFF 透传（Cloudflare Workers）
    const traceparent = request.headers.get('traceparent')
    return fetch('http://localhost:8001/agent/chat', {
      headers: { traceparent }  // 原样透传
    })

Step 3: Python 接收（FastAPI auto-instrumentor）
    # opentelemetry-instrumentation-fastapi 自动从 traceparent 提取
    trace_id = trace.get_current_span().get_span_context().trace_id

Step 4: 强制 LangGraph root run_id = trace_id
    config = {
        "run_id": UUID(int=trace_id),  # 关键：让 LangChain run tree 以此为根
        "callbacks": [langfuse_handler, openllmetry_callback],
        "metadata": {"trace_id": format_trace_id(trace_id)},
    }
    async for event in agent.astream(input, config=config):
        # event.runId 自动 == trace_id（AG-UI BaseEvent 继承）
        yield event

Step 5: 前端从 BaseEvent.runId 关联
    agent.subscribe({
      onTextMessageContentEvent: ({ event }) => {
        const traceId = event.runId
        // 挂到 message store / 一键跳 SigNoz、Langfuse
      }
    })
```

### 2.3 数据流（按平面）

| 平面 | 数据来源 | OTel signal | 后端 | 用途 |
|---|---|---|---|---|
| **通用 trace** | FastAPI / Next.js / Browser fetch | `traces` | SigNoz | 跨服务请求时序 |
| **通用 log** | structlog / browser console | `logs` | SigNoz | 文本搜索、上下文 |
| **通用 metric** | OTel metrics API | `metrics` | SigNoz | SLO、告警 |
| **LLM trace** | OpenLLMetry LangChain auto-instrument | `traces`（GenAI semconv） | Langfuse + SigNoz（双写） | LLM 维度细节、cost、prompt |
| **Eval** | Langfuse Eval pipeline (LLM-as-judge / human) | 独立 trace（`environment=eval`） | Langfuse | 质量回归 |
| **Error** | GlitchTip SDK | 独立协议 | GlitchTip | 错误聚合、source map |
| **Profile**（可选） | py-spy / Pyroscope SDK | profiling 专用 | Pyroscope | CPU/memory 热点 |

---

## 3. 技术选型决策（10 个 ADR）

### ADR-001：OpenTelemetry 作为可观测性 backbone

**决策**：所有 instrumentation 使用 OpenTelemetry SDK + OpenInference 规范，不直接调用任何供应商 SDK。

**选项对比**：

| 方案 | 取舍 |
|---|---|
| **OTel + OpenInference**（采纳） | 行业标准、所有主流后端兼容、可迁移 |
| 直接调 LangSmith / Datadog SDK | 接入快但锁定供应商，迁移即重写 |
| 自建 trace 协议 | 学习负担、生态空白、典型反模式 |

**推理路径**：
1. 调研显示 LangSmith / Langfuse / SigNoz / Honeycomb / Datadog 全部接 OTLP，OTel 已是 lingua franca（[LangSmith → OTel 双向](https://blog.langchain.com/end-to-end-opentelemetry-langsmith/)）
2. OpenInference 是 Arize 主导的 LLM-specific OTel 扩展，比 OTel 官方 GenAI semconv 早一年成熟，且 Phoenix / Langfuse 都支持
3. 选 OTel + OpenInference 而非纯 OTel GenAI semconv，因为 GenAI semconv 仍 experimental（需 `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`）
4. 关键陷阱：所有自定义 attribute 应映射到 OpenInference / GenAI 标准字段，避免供应商专属字段

**风险与对策**：
- **GenAI semconv 仍 experimental** → 锚定到 [semantic-conventions release tag](https://github.com/open-telemetry/semantic-conventions/releases) 而非 main
- **OpenInference 与 GenAI semconv 字段并存** → 写一个 attribute 映射层，单源真理

**官方文档**：
- [OpenTelemetry Specification Overview](https://opentelemetry.io/docs/specs/otel/overview/)
- [GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [OpenInference Semantic Conventions](https://github.com/Arize-ai/openinference/blob/main/spec/semantic_conventions.md)
- [OpenLLMetry](https://github.com/traceloop/openllmetry)

**最佳实践**：
- [OTel for Generative AI (2024)](https://opentelemetry.io/blog/2024/otel-generative-ai/)
- [AI Agent Observability — Evolving Standards (2025)](https://opentelemetry.io/blog/2025/ai-agent-observability/)
- [Datadog: Native support for OTel GenAI semconv](https://www.datadoghq.com/blog/llm-otel-semantic-convention/)

---

### ADR-002：trace_id 统一为 LangChain `run_id` == AG-UI `BaseEvent.runId`

> ⚠️ **2026-04-18 修正**：本 ADR 的"浏览器生成 traceId"部分被 [ADR-002a](#adr-002acopilotkit-限制下traceid-起点退到-bff) 修正。CopilotKit v2 限制下，traceId 起点暂时退到 BFF。**等式 `trace_id == run_id == AG-UI BaseEvent.runId` 仍成立**——只是起点不同。本节保留作"为什么浏览器生成是标准做法"的设计依据。

**决策**：浏览器生成 W3C 32-hex traceId，通过 `traceparent` header 入 BFF→Python，Python 在 LangGraph invoke 时 `config={"run_id": UUID(int=traceId)}`，AG-UI event 通过 `BaseEvent.runId` 自动等于 traceId。

**选项对比**：

| 方案 | 取舍 |
|---|---|
| **LangChain run_id == AG-UI runId**（采纳） | 单源真理，绕开 CopilotKit #3039 |
| 用 AG-UI `rawEvent.metadata.trace_id` | CopilotKit 在 `convertEventToMessage` 时丢失 rawEvent（issue #3039 open，无排期） |
| 自定义 `X-Trace-ID` header + 应用层关联 | 不利用 W3C 标准，未来接入 OTel 工具时仍要写桥接 |
| 让 OTel auto-instrument 自动生成 trace_id | 与 LangChain run_id 不一致，造成两套 ID |

**推理路径**：
1. 调研发现：LangChain `run_id` 是事实上的 trace_id（LangSmith/Langfuse/MLflow 全靠它串 nested span）
2. AG-UI `BaseEvent.runId` 是协议顶层字段（17 种事件全继承），CopilotKit 不会在 `convertEventToMessage` 时丢顶层字段（#3039 只丢 rawEvent）
3. LangGraph 接受 `config={"run_id": UUID}` 强制覆盖 root run_id，让整棵 LangChain run tree 以此 ID 为根
4. W3C traceparent 的 trace_id 是 32-hex，正好能转 UUID（128-bit）
5. 这条链路把"单源真理"建立在协议标准（W3C + AG-UI BaseEvent）上，不依赖某个第三方实现细节

**风险与对策**：
- **CopilotKit HITL 场景下 runId 会变**（issue #3456，PR #3458 in review） → 当前 evaluate 场景无 HITL，上 HITL 前复查 PR 状态
- **EventSource API 不支持自定义 header** → CopilotKit 已用 fetch POST + ReadableStream，天然支持
- **FastAPI auto-instrumentor 在 streaming response 上 span 提前关闭** → 见 ADR-009 的 streaming workaround
- **LangChain Background Callbacks 在 async 下默认丢事件** → 设 `LANGCHAIN_CALLBACKS_BACKGROUND=false`

**官方文档**：
- [LangChain RunnableConfig (run_id)](https://python.langchain.com/api_reference/core/runnables/langchain_core.runnables.config.RunnableConfig.html)
- [Trace LangChain with LangSmith (run_id ↔ trace_id)](https://docs.langchain.com/langsmith/trace-with-langchain)
- [W3C Trace Context spec](https://www.w3.org/TR/trace-context/)
- [AG-UI Events](https://docs.ag-ui.com/concepts/events)

**最佳实践**：
- [Tracetest: Propagating OTel Context Browser → Backend](https://tracetest.io/blog/propagating-the-opentelemetry-context-from-the-browser-to-the-backend)
- [Langfuse: Trace IDs & Distributed Tracing](https://langfuse.com/docs/observability/features/trace-ids-and-distributed-tracing)

---

### ADR-002a：CopilotKit 限制下，traceId 起点退到 BFF

> **状态**：临时妥协。等 CopilotKit issue [#3039](https://github.com/CopilotKit/CopilotKit/issues/3039)（rawEvent 透传）+ [#3456](https://github.com/CopilotKit/CopilotKit/issues/3456)（HITL runId 不刷新）落地后，回切 ADR-002 的"浏览器生成"标准做法。

**决策**：traceId 由 BFF（`apps/web/src/app/api/agent/chat/route.ts`）在每个 incoming request 生成 W3C 32-hex traceparent，通过自定义 `LangGraphHttpAgent` 子类的 `requestInit(input)` override 注入到 Python 出站 fetch。前端不参与生成，通过 SSE `event.runId` 反向获取 traceId。

**为什么不再让浏览器生成（与 ADR-002 标准做法的偏离）**：

CopilotKit v2 1.56.2 锁死了所有"前端 → BFF per-request 数据透传"的口子（依据：本地 `node_modules` 源码 + agent 调研）：

| 我们尝试的路径 | 为什么不通 |
|---|---|
| `useAgent({ runId })` / `<CopilotKit runId>` | 不存在此 API |
| `<CopilotKit headers={() => ...}>` 函数形式 | Provider 构造期常量，不会每次 send 重新求值 |
| `<CopilotKit properties={{ traceId }}>` | 同上，构造期常量 |
| `agent.runAgent({ runId })` 直接调 | CopilotChat 内部走 `copilotkit.runAgent({ agent })`，不接 input；且 `core/index.mjs:1590` 在 runAgent 时强制 `agent.headers = {...this._internal.headers}` 覆盖 |
| `forwardedProps` per-request | 同 properties，构造期常量 |
| Fork CopilotKit | 不可维护，违反 v2 决策原则 |

**等式仍然成立**：`trace_id == LangChain run_id == AG-UI BaseEvent.runId` —— 只是起点从浏览器改到 BFF。其余所有设计（OTel auto-instrument、LangGraph config 注入、structlog OTel processor、前端订阅 BaseEvent.runId）保持不变。

**代价**：
- 丢失"浏览器 → BFF"段（约 50ms 网络 + CORS preflight + 浏览器 fetch 排队）的可观测性
- 用户视角延迟测量失真（trace 起点比"用户点 send"晚 50-500ms）
- HITL 场景未来需要复查 CopilotKit issue #3456 PR 状态

**实施要点**：

```ts
// apps/web/src/app/api/agent/chat/route.ts (替换原 LangGraphHttpAgent)
class TracingLangGraphHttpAgent extends LangGraphHttpAgent {
  protected requestInit(input: RunAgentInput): RequestInit {
    const base = super.requestInit(input);
    // 32-hex trace_id + 16-hex span_id, sampled=1
    const traceId = crypto.randomUUID().replace(/-/g, '');
    const spanId = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    return {
      ...base,
      headers: {
        ...(base.headers as Record<string, string>),
        traceparent: `00-${traceId}-${spanId}-01`,
      },
    };
  }
}
```

**为什么 override `requestInit` 不会被 `agent.headers = {...}` 覆盖**：
`core/index.mjs:1590` 只覆盖实例字段 `agent.headers`，不影响 override 的方法。`requestInit(input)` 内部 `super.requestInit(input)` 拿到（被覆盖后的）headers，再加 traceparent。

**回切路径（issue #3039 / #3456 落地后）**：
1. 移除 `TracingLangGraphHttpAgent`
2. 前端：`<CopilotKit properties={{ traceparent }}>` 或 `useAgent` 的新 runId API
3. BFF：变回 plain `LangGraphHttpAgent`
4. ADR-002 自动生效

**官方文档 / Issue**：
- [CopilotKit issue #3039 — Expose AG-UI rawEvent](https://github.com/CopilotKit/CopilotKit/issues/3039)
- [CopilotKit issue #3456 — runId changes after HITL resolve](https://github.com/CopilotKit/CopilotKit/issues/3456)
- [@ag-ui/client HttpAgent.requestInit 源码](https://github.com/ag-ui-protocol/ag-ui)
- 本地证据：`node_modules/.pnpm/@copilotkit+core@1.56.2_*/node_modules/@copilotkit/core/dist/index.mjs:1588-1617`

---

### ADR-003：OTel Collector 部署模式

**决策**：开发期用 **Agent 模式**（每应用 sidecar 容器），生产期切换 **Gateway 模式**（集中式 collector + tail-based sampling）。

**选项对比**：

| 模式 | 优点 | 缺点 |
|---|---|---|
| **Agent (sidecar)** | 部署简单、网络本地、低延迟 | 无 tail-based sampling、无跨服务路由 |
| **Gateway (集中)** | 统一控制平面、tail sampling、PII 脱敏集中 | 多一跳、Gateway 故障即全失 |
| **混合（Agent → Gateway）** | 兼顾本地降噪 + 集中控制 | 配置复杂，开发期不必要 |
| 直接应用 → 后端（无 Collector） | 无运维负担 | 失去 batch/limiter/路由能力，**陷阱：memory_limiter 不配会 OOM** |

**推理路径**：
1. 开发期单机本地，Agent 模式即可（docker-compose 一个 collector 容器）
2. 生产期跨主机/跨集群，必须 Gateway 集中（处理 tail sampling、attribute 标准化、多目标 fan-out）
3. 关键陷阱（来自调研）：**`memory_limiter` processor 不配会 OOM 干掉 collector**——文档要把这个写死
4. Gateway 也是企业级技能学习点（学 collector pipeline 设计 + 容量规划）

**风险与对策**：
- **memory_limiter 不配 OOM** → docker-compose 模板里默认配 `memory_limiter` + `batch` 两个 processor
- **Gateway 单点故障** → 生产期至少 2 副本 + 应用侧 sending queue
- **OTLP gRPC 在 Edge runtime 不可用** → BFF 走 OTLP HTTP（见 ADR-009）

**官方文档**：
- [OTel Collector Deployment](https://opentelemetry.io/docs/collector/deploy/)
- [Agent deployment pattern](https://opentelemetry.io/docs/collector/deploy/agent/)
- [Gateway deployment pattern](https://opentelemetry.io/docs/collector/deploy/gateway/)
- [Collector Architecture](https://opentelemetry.io/docs/collector/architecture/)

---

### ADR-004：通用 trace/log/metric 后端 = SigNoz 自托管

**决策**：自托管 SigNoz（ClickHouse 单后端，docker-compose 起步），与 Langfuse 共享 ClickHouse 实例节省资源。

**选项对比**：

| 后端 | 自托管复杂度 | OTel 兼容 | LLM 场景适配 | 关键陷阱 | 决策 |
|---|---|---|---|---|---|
| **SigNoz**（采纳） | 中（ClickHouse 单后端） | OTel-first | 0.50+ 有 LLM dashboard 模板 | ClickHouse 升级 breaking 多 | ✅ |
| Grafana LGTM | 高（4 服务 + S3 + Agent） | 原生 | Tempo 无 LLM view，需手写 dashboard | Loki 高基数 label 会爆炸 | ❌ 运维过重 |
| Honeycomb SaaS | N/A | 原生 OTLP | trace UX 业内最佳 | **单 event 2000 attribute 限制，LLM 长 prompt 撑爆** | ❌ 关键陷阱 |
| Datadog SaaS | N/A | OTel 支持但 DD Agent 体验更好 | LLM Observability 独立产品（独立计费） | **custom metric 单价失控，$$$ 经典案例多** | ❌ 锁定 + 失控 |
| Axiom SaaS | N/A | 原生 OTLP | 无专门 LLM view | 查询 UI 弱、alerting 较新 | ❌ 不够生产级 |
| Better Stack | N/A | OTLP + Vector | 无 | 核心强项是 uptime monitoring | ❌ 范围窄 |

**推理路径**：
1. **Honeycomb 的 2000 attribute 限制**直接淘汰它做 LLM 后端——LangGraph 一次对话的 prompt + tool result 轻松超过
2. **Datadog 的 custom metric 单价 + LLM Observability 独立计费**对个人/小团队是定时炸弹
3. **LGTM 4 组件运维成本**对学习价值是加分，但单后端的 SigNoz 学起来更聚焦（ClickHouse 一通百通）
4. **SigNoz 与 Langfuse 都用 ClickHouse**——可共享实例，节省资源
5. **企业级演进路径**：本地 docker-compose → 生产 K8s + ClickHouse 集群（这条路径在文档中显式画出）

**风险与对策**：
- **ClickHouse 升级 breaking 多，schema migration 偶尔丢数据** → 锁定 SigNoz 主版本，升级前完整备份 + dry run
- **`trace_id` / `user_id` 当 Loki/SigNoz label 会爆炸** → 严格规范：高基数字段必须放 log line / span attribute，不进 label

**官方文档**：
- [SigNoz Self-host overview](https://signoz.io/docs/install/self-host/)
- [SigNoz Docker Standalone install](https://signoz.io/docs/install/docker/)
- [SigNoz LangChain & LangGraph Observability with OTel](https://signoz.io/docs/langchain-observability/)

**最佳实践**：
- [grafana/docker-otel-lgtm — 一年回顾 (2025)](https://grafana.com/blog/2025/07/08/observability-in-under-5-seconds-reflecting-on-a-year-of-grafana/otel-lgtm/) —— 即使不选 LGTM，这篇文章对 OTel 后端选型决策有参考价值

---

### ADR-005：LLM 专用 trace + Eval 后端 = Langfuse 自托管

**决策**：自托管 Langfuse v3（docker-compose 起步），通过 OpenInference + OTel collector 与 SigNoz 双写。Eval 平面也用 Langfuse 内置（不另起 Phoenix）。

**选项对比**：

| 工具 | License | LangGraph 集成 | 自托管 | Eval 能力 | 与通用后端协同 | 决策 |
|---|---|---|---|---|---|---|
| **Langfuse**（采纳） | MIT (core) | `langfuse.langchain.CallbackHandler` 一行接入 | ✅ docker-compose / k8s helm 官方维护 | LLM-as-judge + human + dataset + experiment 全套 | OTLP 双写 OK | ✅ |
| LangSmith | 闭源 | 原生最深 | ❌ | 最成熟（Datasets + Evaluators + Experiments） | 难（封闭） | ❌ 闭源 + **按 run 计费坑（一次对话 50+ run）** |
| Arize Phoenix | Apache 2.0 (OSS) | OpenInference 自动 hook | ✅ Python 进程轻量 | Phoenix evaluator 库强 | OpenInference span 双写 | ❌ UI 不如 Langfuse + Phoenix/Arize AX 双线分裂 |
| Helicone | Apache 2.0 | proxy 拦截，对 LangGraph node 不可见 | 可（重） | 基础 scoring | 部分 | ❌ proxy 多一跳延迟 + 单点故障 |
| W&B Weave | 闭源（部分） | `weave.init()` + 装饰器 | ❌ | 偏 ML 训练视角 | 弱 | ❌ W&B 主产品强绑定 |

**推理路径**：
1. **Langfuse vs LangSmith**：Langfuse 开源 + 自托管能力，LangSmith 闭源且按 run 计费（LangGraph 一次对话产生 50+ run 是常态，比预估贵 5-10 倍）
2. **Langfuse vs Phoenix**：Langfuse UI 更精致 + prompt management + 商业化路径清晰；Phoenix OSS 与 Arize AX SaaS 文档混淆容易踩
3. **Eval 不另起 Phoenix**：Langfuse 自带 LLM-as-judge + dataset + experiment + human annotation，单工具够用
4. **关键设计：eval trace 用 `environment=eval` filter 与应用 trace 隔离**（Langfuse 2025-10 changelog 标准做法）—— 避免评估流量污染应用监控
5. **协同**：通过 `OpenLLMetry` 让 LangChain auto-instrument 同时输出到 Langfuse + SigNoz，不需要在代码里写两遍

**风险与对策**：
- **Langfuse v3 强依赖 5 组件**（PG + ClickHouse + Redis + S3/MinIO + 2 容器） → 与 SigNoz 共享 ClickHouse；学习这套栈本身是企业级技能
- **Langfuse self-host 的 ClickHouse 升级**（0.x → 1.x 需 manual migration） → 锁定主版本，升级前看 release notes
- **EE feature gate 增多**（SSO、audit log 收费） → 个人项目不需要，注意未来不要陷入 EE 依赖
- **CF Edge runtime 上 Langfuse OTel 路径不可用**（Discussion #10715） → BFF 不直接调 Langfuse，走 OTel collector 中转

**官方文档**：
- [Langfuse Self-hosting overview](https://langfuse.com/self-hosting)
- [Langfuse Docker Compose deployment](https://langfuse.com/self-hosting/deployment/docker-compose)
- [Langfuse LangChain integration](https://langfuse.com/integrations/frameworks/langchain)
- [Langfuse OpenTelemetry / W3C Trace Context](https://langfuse.com/integrations/native/opentelemetry)
- [Langfuse LLM-as-a-Judge docs](https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge)

**最佳实践**：
- [Langfuse Trace and Evaluate LangGraph Agents (cookbook)](https://langfuse.com/guides/cookbook/example_langgraph_agents)
- [Langfuse LLM Evaluation 101 (2025-03)](https://langfuse.com/blog/2025-03-04-llm-evaluation-101-best-practices-and-challenges)
- [Langfuse vs LangSmith — Mirascope hands-on](https://mirascope.com/blog/langsmith-vs-langfuse) —— 第三方相对中立对比
- [Langfuse vs LangSmith — ZenML 视角](https://www.zenml.io/blog/langfuse-vs-langsmith)

---

### ADR-006：错误聚合 = GlitchTip 自托管

**决策**：自托管 GlitchTip（AGPL，Sentry SDK 兼容协议），不用 Sentry 自托管。

**选项对比**：

| 工具 | 自托管复杂度 | OTel trace_id 关联 | 与 Sentry SDK 兼容 | 决策 |
|---|---|---|---|---|
| **GlitchTip**（采纳） | 低（Django + Postgres） | Sentry 协议子集，trace 关联弱⚠️ | ✅ 完全兼容 | ✅ |
| Sentry 自托管 | **高（20+ 容器，吃 8GB RAM 起）** | 1.40+ 原生支持 W3C traceparent | 原生 | ❌ 单用户严重过度 |
| Sentry SaaS | N/A | 原生 | 原生 | ⚠️ BSL 协议，付费门槛 |
| Rollbar / Bugsnag | N/A | 部分 | 不兼容 | ❌ UI 老旧 / 收购后迭代慢 |

**推理路径**：
1. **Sentry 自托管 20+ 容器吃 8GB RAM 起** ← 关键陷阱，单用户场景严重过度
2. **GlitchTip 是 Sentry 协议兼容的轻量替代**（AGPL + Django + Postgres），未来要切 Sentry SDK 或 Sentry SaaS 都没成本
3. **trade-off**：GlitchTip 不接收 Sentry SDK 2.0 部分新 feature（profiling、metrics）会静默丢数据 → profiling 走 Pyroscope（独立平面），metrics 走 SigNoz，不依赖 Sentry SDK 这条路径
4. **企业级演进**：GlitchTip 作为开发期工具；如未来上百人团队、需要 source map artifact bundle / 高级 alerting 再切 Sentry SaaS

**风险与对策**：
- **GlitchTip 静默丢 Sentry SDK 2.0 新 feature 数据** → 不依赖 SDK 高级 feature；profiling/metrics 走独立工具
- **trace 关联弱** → 在异常上下文显式带 `trace_id` attribute（OTel context propagation 已经把 trace_id 放进 contextvars）

**官方文档**：
- [GlitchTip docs](https://glitchtip.com/documentation)（注：URL 需在落档前再确认一次）
- [Sentry Self-hosted (Developer Docs)](https://develop.sentry.dev/self-hosted/) —— 用作"我们为什么不选这个"的对照

---

### ADR-007：前端 SDK = OTel browser SDK + GlitchTip browser SDK

**决策**：
- **Trace**：`@opentelemetry/sdk-web` + `@opentelemetry/instrumentation-fetch` + `@opentelemetry/instrumentation-document-load`
- **Error**：GlitchTip browser SDK（Sentry SDK 兼容）
- **不上**：Sentry browser OTel（Sentry 团队明确表示短期不投入 browser OTel，见 sentry-javascript discussion #7364）

**选项对比**：

| 方案 | 取舍 |
|---|---|
| **OTel browser SDK + GlitchTip**（采纳） | 标准 trace + 兼容 Sentry SDK 错误聚合 |
| Honeycomb beeline browser | 私有协议，迁出成本高 |
| 纯 console.log + Network tab | 无持久化，无关联 |
| Datadog browser SDK | vendor lock-in |

**推理路径**：
1. 调研明确：**浏览器 OTel 仍是 experimental**（OTel JS getting-started 页面明示），但 Honeycomb browser docs 是当前生产级度最高的实现指南
2. CORS 关键：`fetch` instrumentation 必须配 `propagateTraceHeaderCorsUrls`，BFF CORS 必须 allow `traceparent` / `tracestate` header（discussion #2209）
3. **错误聚合不走 OTel** —— Sentry/GlitchTip 协议在错误维度仍优于 OTel logs，且 source map 自动上传是它们的强项
4. **不上 Sentry browser OTel** —— 官方明确不投入，避免双 SDK 维护

**风险与对策**：
- **浏览器 OTel SDK 体积大**（几百 KB） → 仅在生产环境异步加载，开发用 console + DevTools
- **CORS 配置错误导致 trace 不连** → CI/CD 加自动验证（用 Tracetest 类工具）
- **EventSource 不支持自定义 header** → CopilotKit 用 fetch POST，已天然支持

**官方文档**：
- [OpenTelemetry JS Browser Getting Started](https://opentelemetry.io/docs/languages/js/getting-started/browser/)
- [open-telemetry/opentelemetry-browser](https://github.com/open-telemetry/opentelemetry-browser)
- [OTel JS Instrumentation libraries](https://opentelemetry.io/docs/languages/js/libraries/)

**最佳实践**：
- [Honeycomb: Observable Frontends — State of OTel in the Browser](https://www.honeycomb.io/blog/observable-frontends-opentelemetry-browser) —— 决策必读
- [Honeycomb Browser JS docs](https://docs.honeycomb.io/send-data/javascript-browser) —— 唯一一份生产级浏览器 OTel 实现指南
- [Tracetest: Propagating OTel Context Browser → Backend](https://tracetest.io/blog/propagating-the-opentelemetry-context-from-the-browser-to-the-backend)
- [OTel JS Discussion #2209: Frontend→Backend trace 不透传](https://github.com/open-telemetry/opentelemetry-js/discussions/2209)

---

### ADR-008：BFF Edge runtime 限制处理

**决策**：
- 当前阶段：CF Pages BFF 使用 `evanderkoogh/otel-cf-workers`（fetch-based OTLP exporter）
- 接受 Next.js middleware tracing 不完整（issue #80445）
- 长期：评估迁出 Pages 到容器（K8s/Fly.io），消除 Edge 限制

**选项对比**：

| 方案 | 取舍 |
|---|---|
| **otel-cf-workers**（采纳） | 唯一在 Workers 上跑通 OTel SDK 的实现，用 ctx.waitUntil 异步导出 |
| 应用代码内手工 fetch OTLP | 完全绕开 SDK，失去 instrumentation 生态 |
| 完整 OpenTelemetry Node SDK | **Edge runtime 不支持**（Node API 缺失） |
| @vercel/otel | 仅 Vercel 平台，不适配 CF Pages |

**推理路径**：
1. 调研明确：**Cloudflare Workers/Pages Edge runtime 不能跑完整 OTel Node SDK**（依赖 Node API），必须用 fetch-based exporter
2. `otel-cf-workers` 是社区维护、最成熟的方案，已被 Cloudflare 自家 AI Gateway 文档引用
3. 接受当前限制：Next.js Edge middleware 不出 span（#80445），middleware 与 page 分开 trace
4. **长期演进路径**：BFF 迁出 Pages 到容器化部署（K8s / Fly.io），上完整 Node SDK——这个决策延后，等触发条件（多用户、需要 metrics 自定义、需要 profiling）再做

**风险与对策**：
- **Edge runtime 不能跑 Node SDK** → 用 otel-cf-workers，接受功能子集
- **Next.js middleware tracing 不完整** → 关键追踪逻辑放 page handler 而非 middleware
- **OTLP gRPC 在 Workers 不可用** → 走 OTLP HTTP/JSON

**官方文档**：
- [Cloudflare Workers — Exporting OpenTelemetry Data](https://developers.cloudflare.com/workers/observability/exporting-opentelemetry-data/)
- [evanderkoogh/otel-cf-workers](https://github.com/evanderkoogh/otel-cf-workers)
- [Next.js OpenTelemetry guide](https://nextjs.org/docs/app/guides/open-telemetry)
- [Next.js Edge Runtime OTel limitations issue (#80445)](https://github.com/vercel/next.js/issues/80445)

**最佳实践**：
- [Cloudflare Workers tracing open beta (blog)](https://blog.cloudflare.com/workers-tracing-now-in-open-beta/)
- [Cloudflare AI Gateway — OpenTelemetry](https://developers.cloudflare.com/ai-gateway/observability/otel-integration/) —— Cloudflare 自家 LLM 网关的 OTel span 字段（GenAI semconv）参考

---

### ADR-009：Python FastAPI streaming 的 OTel 处理

**决策**：使用 `opentelemetry-instrumentation-fastapi` 自动接 traceparent，但对 SSE streaming endpoint **手动用 `tracer.start_as_current_span()` 包住 generator**，规避已知 ASGI streaming span 提前关闭问题。

**选项对比**：

| 方案 | 取舍 |
|---|---|
| **auto-instrument + 手动 SSE workaround**（采纳） | 兼顾自动化与流式正确性 |
| 完全手动 instrument | 失去 framework auto-instrument，重复劳动 |
| 不上 OTel，纯 structlog | 失去跨进程 trace 关联（违背 ADR-002） |

**推理路径**：
1. **关键陷阱（多个 issue 印证）**：
   - [opentelemetry-python-contrib #831](https://github.com/open-telemetry/opentelemetry-python-contrib/issues/831) —— ASGI 多余 internal span，含 streaming 场景
   - [opentelemetry-python-contrib #3267](https://github.com/open-telemetry/opentelemetry-python-contrib/issues/3267) —— propagation 启用时 FastAPI streaming span 不上报
   - [opentelemetry-python #4430](https://github.com/open-telemetry/opentelemetry-python/issues/4430) —— context propagated 后 span 默认不录制
2. 已有 [workaround gist](https://gist.github.com/Blueswen/f5dcc72d2ce0966fa7f106332adc7433) —— 自定义 ASGI middleware
3. AG-UI SSE endpoint（`/agent/chat`）必须套一层手动 span，确保整段 stream 的 span 在 generator 结束才 close
4. **LangChain Background Callbacks** 在 async 下默认丢事件，必须 `LANGCHAIN_CALLBACKS_BACKGROUND=false`

**风险与对策**：
- **升级 opentelemetry-python 1.26.0 有回归**（issue #4111） → 锁定版本，升级前看回归测试
- **streaming 场景 span 提前关闭** → 自定义 ASGI middleware（按 gist），CI 加 trace 完整性测试
- **GenAI semconv 仍 experimental** → 设 `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`

**官方文档**：
- [opentelemetry-instrumentation-fastapi (RTD)](https://opentelemetry-python-contrib.readthedocs.io/en/latest/instrumentation/fastapi/fastapi.html)
- [LangChain RunnableConfig](https://python.langchain.com/api_reference/core/runnables/langchain_core.runnables.config.RunnableConfig.html)

**最佳实践**：
- [Google Cloud — Instrument a LangGraph ReAct agent with OTel](https://docs.cloud.google.com/stackdriver/docs/instrumentation/ai-agent-langgraph) —— 大厂出品，端到端教程
- [CVxTz/opentelemetry-langgraph-langchain-example](https://github.com/CVxTz/opentelemetry-langgraph-langchain-example) —— FastAPI + LangGraph + LangChain 最小可跑示例
- [End-to-End OTel Support in LangSmith (blog)](https://blog.langchain.com/end-to-end-opentelemetry-langsmith/)

---

### ADR-010：`agui_tracing.py` 重构（拆 observation / enforcement + GenAI semconv 适配）

**决策**：将 `agents/radar/src/radar/agui_tracing.py` 拆分为三个模块：

```
agents/radar/src/radar/observability/
  ├── tracer.py       # 只观测，不修改事件流；emit OTel span 给 collector
  ├── repair.py       # 现有 3 层去重，按 env flag (REPAIR_AGUI_DEDUP=1) 启用
  ├── gen_ai_attrs.py # AG-UI event → GenAI semconv attribute 映射
  └── persist.py      # 现有 chat persistence 逻辑（与 trace 解耦）
```

**同时给上游开 issue/PR**：
- `ag-ui-langgraph` 重复 START 事件
- DeferredLLM 引发的 `on_chat_model_stream` 双重发射
- CopilotKit `convertEventToMessage` 丢 rawEvent (issue #3039 关注 + 评论)

**选项对比**：

| 方案 | 取舍 |
|---|---|
| **拆分 + 上游 PR**（采纳） | 观测/修复分离，根因可见，长期消除补丁 |
| 保留现状 | 补丁层永远抹掉根因，未来每次问题都要重新考古 |
| 完全删除 enforcement | 上游 bug 再现，前端崩 |
| 把所有逻辑塞进 OTel exporter | 违反 collector 职责边界（不应该改事件流） |

**推理路径**：
1. **观测/修复必须分离**（v2 决策原则之一）：tracer 只产 span 给 collector；repair 是补丁层，必须显式开关
2. **GenAI semconv 适配**：所有 LangGraph node span / LLM call span 必须按 OTel GenAI semconv 标记（`gen_ai.system` / `gen_ai.request.model` / `gen_ai.response.finish_reason` 等），让 SigNoz 和 Langfuse 能识别
3. **上游贡献**：给 ag-ui-langgraph 提 issue/PR 是真正修根因的方式；这本身也是企业级 OSS 协作技能
4. **persist.py 独立**：当前 `agui_tracing` 还混了 `persist_chat_ok` 持久化逻辑，应该解耦

**风险与对策**：
- **GenAI semconv 字段命名变化**（experimental） → 锁定 semconv release tag，写 attribute 映射层
- **上游 PR 不被接受** → repair.py 保留，但加显式 deprecated 注释 + 跟踪 upstream 状态
- **重构破坏现有去重**（前端崩） → 先加 OTel span 双轨运行，validate 后再切

**官方文档**：
- [GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [GenAI Agent and Framework Spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/)
- [GenAI Client Spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/)
- [GenAI Attribute Registry](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)

**最佳实践**：
- [LangChain: On Agent Frameworks and Agent Observability](https://blog.langchain.com/on-agent-frameworks-and-agent-observability/)
- [VictoriaMetrics: AI Agents Observability with OTel](https://victoriametrics.com/blog/ai-agents-observability/)

---

## 4. 实施路线图

每个阶段独立可交付，每阶段后系统都比之前好（不会半成品阻塞）。

### Phase 0：决策固化（本文档）

- ✅ 完成 v1→v2 选型重新评估
- ✅ 10 个 ADR 落地
- ✅ 路线图与风险清单

**交付物**：本文档

---

### Phase 1：trace_id 透传基础链路（最小可行）

> 2026-04-18 修订：依据 ADR-002a，traceId 起点从浏览器改到 BFF。前端不再生成 traceparent。

**目标**：一次 chat 在 BFF / Python / 前端订阅 三端共享同一 trace_id（短缺：浏览器 fetch 段不可见，Phase N 等 CopilotKit 修后回切）。

**任务**：
1. ~~浏览器：CopilotChat 的 fetch 拦截器中 `crypto.randomUUID()` → `traceparent` header~~ **取消**（CopilotKit 限制，见 ADR-002a）
2. BFF：新建 `TracingLangGraphHttpAgent extends LangGraphHttpAgent`，override `requestInit(input)` 在出站 fetch 注入 `traceparent` header
3. Python：`uv add opentelemetry-distro opentelemetry-instrumentation-fastapi`，main.py 调 `FastAPIInstrumentor.instrument_app(app)` 自动从 traceparent 提取 trace_id
4. Python：在 `agui_tracing.TracingLangGraphAGUIAgent.run()` 里从 `trace.get_current_span()` 提 trace_id，构造 LangGraph config `{"run_id": UUID(int=trace_id), "metadata": {"trace_id": hex_str}, "callbacks": [...]}`
5. structlog：加 OTel processor 从 current span 自动注入 `trace_id` 到每条 log
6. `.env`：`LANGCHAIN_CALLBACKS_BACKGROUND=false`
7. 前端：在 `SessionDetail.tsx` 订阅 AG-UI 事件，从 `event.runId` 反向获取 traceId，console.log 验证

**验收**：浏览器 console 输出的 `event.runId` == Python structlog 每条 log 的 `trace_id` == 出站 fetch 的 `traceparent` 中段。

**依赖**：无（独立改动）

**估算**：1-2 天

---

### Phase 2：Langfuse Cloud Hobby 验证（LLM trace 起步）

**目标**：先用 Langfuse Cloud 验证"LangChain callback 自动捕获 LangGraph 全栈"是真的，建立对 LLM trace 价值的直观感受。

**任务**：
1. 注册 Langfuse Cloud Hobby（免费）
2. Python 加 `langfuse.langchain.CallbackHandler`
3. LangGraph config 加 `callbacks: [handler, ...]`
4. 设 `LANGCHAIN_CALLBACKS_BACKGROUND=false`
5. 跑一次 chat → Langfuse UI 看 trace tree（每个 node + LLM call + tool call 的 timing/prompt/cost）

**验收**：Langfuse UI 能看到从 LangGraph 入口到 LLM 调用到工具结果的完整树，trace_id 与 Phase 1 一致。

**依赖**：Phase 1（trace_id 已贯穿）

**估算**：半天

**说明**：这个阶段刻意用 Cloud 不上自托管——验证价值后再投资自托管运维。如果 LLM trace 价值不如预期，可以停在这里；如果价值很大，进入 Phase 4。

---

### Phase 3：OTel SDK 三端接入（统一 instrumentation）

**目标**：浏览器/BFF/Python 都用 OTel SDK 产出 OTLP，发给一个本地 collector。

**任务**：
1. **本地起 OTel collector**（docker-compose），配 `memory_limiter` + `batch` + console exporter（先不连后端）
2. **Python**：装 `opentelemetry-distro` + `opentelemetry-instrumentation-fastapi` + `opentelemetry-instrumentation-httpx`，配 OTLP HTTP exporter 指向 collector
3. **Python**：装 `traceloop-sdk`（OpenLLMetry）auto-instrument LangChain / OpenAI
4. **BFF**：CF Pages 接入 `evanderkoogh/otel-cf-workers`，配 OTLP HTTP exporter
5. **浏览器**：`@opentelemetry/sdk-web` + `instrumentation-fetch` + `instrumentation-document-load`，配 OTLP HTTP exporter + `propagateTraceHeaderCorsUrls`
6. **CORS**：BFF 允许 `traceparent` / `tracestate` header
7. **验证**：浏览器一次 chat → collector 看到三段 span 串成一棵树

**验收**：collector console 输出的 trace 包含 browser fetch span / BFF span / Python FastAPI span / LangGraph node span / LLM call span。

**依赖**：Phase 1

**估算**：3-5 天

---

### Phase 4：自托管栈搭建（SigNoz + Langfuse + GlitchTip）

**目标**：所有 OTel 数据落到自己控制的后端。

**任务**：
1. **SigNoz**：docker-compose 起单机版（含 ClickHouse），配置数据保留 30 天
2. **Langfuse**：docker-compose 起 v3（与 SigNoz 共享 ClickHouse）
3. **GlitchTip**：docker-compose 起轻量版
4. **collector exporter 配置**：trace 双写到 SigNoz + Langfuse；log → SigNoz；metric → SigNoz；error → GlitchTip（独立协议）
5. **Eval 平面**：Langfuse 内置 LLM-as-judge，配独立 `environment=eval`
6. **dashboard / alert**：SigNoz 配几个基础 dashboard（chat 延迟、LLM token 用量、错误率）

**验收**：
- SigNoz 看到所有 trace/log/metric
- Langfuse 看到 LLM 维度细节
- GlitchTip 看到错误聚合
- 三个工具用同一 trace_id 互查

**依赖**：Phase 3

**估算**：1-2 周（含运维学习）

---

### Phase 5：`agui_tracing` 重构 + GenAI semconv 适配

**目标**：观测/修复分离，所有 span 按 OpenInference / GenAI semconv 标准化。

**任务**：
1. 拆 `agui_tracing.py` 为 4 模块（见 ADR-010）
2. `tracer.py` 用 OTel API 产 span（双轨与现有 structlog 并存一段时间）
3. `gen_ai_attrs.py` 把 AG-UI event 字段映射到 GenAI semconv attribute
4. `repair.py` 加 env flag `REPAIR_AGUI_DEDUP=1`，默认开启（保护前端不崩）
5. `persist.py` 独立 chat 持久化逻辑
6. `LANGCHAIN_CALLBACKS_BACKGROUND=false` 验证

**验收**：
- SigNoz 中所有 LangGraph node span 用 OpenInference / GenAI semconv 字段
- 关闭 `REPAIR_AGUI_DEDUP` 时能在 collector 看到原始重复 START 事件（root cause 重新可见）

**依赖**：Phase 4

**估算**：1 周

---

### Phase 6：上游贡献

**目标**：给 ag-ui-langgraph、CopilotKit 提 issue / PR，从根上消除补丁。

**任务**：
1. 给 `ag-ui-protocol/ag-ui` 提 issue：本地模型重复 START 事件（附 minimal repro）
2. 评论 / 跟进 CopilotKit issue #3039（rawEvent 丢失）和 #3208（INCOMPLETE_STREAM）
3. 评估给 `ag-ui-langgraph` 提 PR 加 GenAI semconv attribute 透传
4. （可选）写一篇博客记录这次 observability 改造的工程决策

**验收**：上游 issue/PR 至少 1 条被 acknowledge / merged。

**依赖**：Phase 5

**估算**：持续投入（碎片时间）

---

### Phase 7（可选）：Profiling + Metrics SLO

**目标**：完整六维 observability。

**任务**：
1. Pyroscope 集成（py-spy + Python instrumentation）
2. SigNoz 中定义关键 SLO：chat P99 延迟、LLM token 错误率、cost per chat
3. 告警规则：SLO 违反 → GlitchTip / 邮件

**触发条件**：当性能瓶颈成为问题（P95 > 5s）或上多用户场景

---

## 5. 已知风险与对策（综合表）

| # | 风险 | 来源 | 对策 |
|---|---|---|---|
| 1 | FastAPI `StreamingResponse` 的 OTel span 提前关闭 | opentelemetry-python-contrib #831 / #3267 / #4430 | 自定义 ASGI middleware（gist workaround） |
| 2 | LangChain >0.3 在 async 下默认 background callbacks，丢事件 | Langfuse 文档明确警告 | 设 `LANGCHAIN_CALLBACKS_BACKGROUND=false` |
| 3 | CF Pages Edge runtime 不支持完整 OTel Node SDK | 通用 Edge 限制 + Langfuse #10715 | 用 otel-cf-workers + fetch-based OTLP |
| 4 | Next.js Edge middleware tracing 不完整（不出 span / 与 page 分 trace）| Next.js #80445 | 关键追踪逻辑放 page handler |
| 5 | OTel collector `memory_limiter` 不配会 OOM 干掉 agent | 教程都漏 | docker-compose 模板里默认配 |
| 6 | Honeycomb 单 event 2000 attribute 限制，LLM 长 prompt 撑爆 | 选型陷阱 | 不选 Honeycomb 做主后端 |
| 7 | LangSmith 按 run 计费，LangGraph 一次对话 50+ run | 选型陷阱 | 不选 LangSmith，用 Langfuse |
| 8 | Sentry 自托管 20+ 容器吃 8GB+ RAM | 选型陷阱 | 用 GlitchTip 替代 |
| 9 | Loki / SigNoz 把 trace_id/user_id 当 label 会爆炸 | 通用陷阱 | 严格规范：高基数字段进 log line / span attribute，不进 label |
| 10 | Langfuse v3 ClickHouse 升级 breaking | Langfuse 自托管陷阱 | 锁定主版本，升级前完整备份 + dry run |
| 11 | GlitchTip 不接收 Sentry SDK 2.0 部分新 feature | GlitchTip 陷阱 | profiling 走 Pyroscope，metrics 走 SigNoz，不依赖 Sentry SDK 高级功能 |
| 12 | OTel GenAI semconv 仍 experimental | 标准本身 | 锁定 semantic-conventions release tag，加 `OTEL_SEMCONV_STABILITY_OPT_IN` |
| 13 | OpenInference vs OTel GenAI semconv 字段并存 | 两套标准 | 写 attribute 映射层，单源真理 |
| 14 | 浏览器 OTel SDK 仍 experimental | OTel JS getting-started 明示 | 参考 Honeycomb browser docs（生产级实现指南） |
| 15 | CopilotKit HITL 场景 runId 会变 | issue #3456，PR #3458 | 当前无 HITL；上 HITL 前复查 PR 状态 |
| 16 | CORS 配置错误导致 trace 不连 | OTel JS discussion #2209 | CI/CD 加自动验证 |
| 17 | 1.26.0 opentelemetry-python auto-instrument 回归 | issue #4111 | 锁定版本，升级前看回归 |

---

## 6. 不做什么（明确边界）

| 不做 | 理由 |
|---|---|
| ❌ Datadog / New Relic / 任何按 host 收费的 SaaS | 单用户场景不划算 + vendor lock-in |
| ❌ Sentry 自托管 20+ 容器栈 | 严重过度，用 GlitchTip 替代 |
| ❌ Honeycomb（做主 trace 后端） | 2000 attribute 限制 LLM 撑爆 |
| ❌ LangSmith（做主 LLM trace 后端） | 闭源 + 按 run 计费 + LangGraph 50+ run |
| ❌ Helicone（proxy 模式） | 多一跳延迟 + 单点故障 + 对 LangGraph node 不可见 |
| ❌ fork CopilotKit core | 不可维护，等上游 issue #3039 |
| ❌ 完整 LGTM 栈 | 4 组件运维过重，SigNoz 单后端足够 |
| ❌ 自建"trace 中间存储表" | SigNoz/Langfuse 已经是这个东西 |
| ❌ Highlight.io | **2026-02-28 已停服**（被 LaunchDarkly 收购） |
| ❌ Sentry browser OTel | Sentry 团队明确短期不投入 |
| ❌ 写自己的 OTel exporter / 协议 | 标准已经够用，重新发明 |
| ❌ 不上 OTel collector，应用直推后端 | 失去 batch/limiter/路由能力，OOM 风险 |

---

## 7. 附录：官方文档与最佳实践索引

> 本附录是文档全部决策依据的"参考书目"，按主题分组。所有链接在 2026-04-18 验证可达。GenAI semconv 等仍 experimental 主题需在落地时再次复核版本号。

### 7.1 OpenTelemetry 基础

- [OpenTelemetry Specification Overview](https://opentelemetry.io/docs/specs/otel/overview/) — OTel 整体架构与 signals 模型
- [What is OpenTelemetry?](https://opentelemetry.io/docs/what-is-opentelemetry/) — 一页式 framework 总览
- [OTel Collector Deploy](https://opentelemetry.io/docs/collector/deploy/) — 部署模式索引
- [Agent deployment pattern](https://opentelemetry.io/docs/collector/deploy/agent/)
- [Gateway deployment pattern](https://opentelemetry.io/docs/collector/deploy/gateway/)
- [Collector Architecture](https://opentelemetry.io/docs/collector/architecture/) — receiver/processor/exporter 管道模型
- [W3C Trace Context (Recommendation)](https://www.w3.org/TR/trace-context/)
- [W3C Trace Context Level 2](https://www.w3.org/TR/trace-context-2/)

### 7.2 GenAI semantic conventions

- [GenAI Semantic Conventions (index)](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [GenAI Agent and Framework Spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/)
- [GenAI Client Spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/)
- [GenAI Events](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-events/)
- [GenAI Metrics](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/)
- [GenAI Attribute Registry](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)
- [semantic-conventions Releases](https://github.com/open-telemetry/semantic-conventions/releases)
- [OTel for Generative AI (blog, 2024)](https://opentelemetry.io/blog/2024/otel-generative-ai/)
- [AI Agent Observability — Evolving Standards (2025)](https://opentelemetry.io/blog/2025/ai-agent-observability/)
- [OpenInference Semantic Conventions](https://github.com/Arize-ai/openinference/blob/main/spec/semantic_conventions.md)
- [Arize-ai/openinference](https://github.com/Arize-ai/openinference)

### 7.3 OpenLLMetry

- [traceloop/openllmetry](https://github.com/traceloop/openllmetry)
- [OpenLLMetry — LangChain Instrumentation](https://github.com/traceloop/openllmetry/tree/main/packages/opentelemetry-instrumentation-langchain)
- [What is OpenLLMetry](https://www.traceloop.com/docs/openllmetry/introduction)

### 7.4 Python + LangGraph instrumentation

- [opentelemetry-instrumentation-fastapi (RTD)](https://opentelemetry-python-contrib.readthedocs.io/en/latest/instrumentation/fastapi/fastapi.html)
- [opentelemetry-instrumentation-fastapi 源码](https://github.com/open-telemetry/opentelemetry-python-contrib/tree/main/instrumentation/opentelemetry-instrumentation-fastapi)
- [opentelemetry-python-contrib #831](https://github.com/open-telemetry/opentelemetry-python-contrib/issues/831) — FastAPI ASGI streaming 多余 span
- [Workaround gist (custom middleware)](https://gist.github.com/Blueswen/f5dcc72d2ce0966fa7f106332adc7433)
- [opentelemetry-python #4111](https://github.com/open-telemetry/opentelemetry-python/issues/4111) — 1.26.0 回归
- [opentelemetry-python-contrib #3267](https://github.com/open-telemetry/opentelemetry-python-contrib/issues/3267)
- [opentelemetry-python #4430](https://github.com/open-telemetry/opentelemetry-python/issues/4430)
- [LangChain RunnableConfig (Python API)](https://python.langchain.com/api_reference/core/runnables/langchain_core.runnables.config.RunnableConfig.html)
- [LangChain runnables/config.py 源码](https://github.com/langchain-ai/langchain/blob/master/libs/core/langchain_core/runnables/config.py)
- [Trace LangChain with LangSmith](https://docs.langchain.com/langsmith/trace-with-langchain)
- [Trace LangChain via OpenTelemetry](https://docs.langchain.com/langsmith/trace-with-opentelemetry)
- [End-to-End OTel Support in LangSmith (blog)](https://blog.langchain.com/end-to-end-opentelemetry-langsmith/)
- [Introducing OTel Support for LangSmith](https://blog.langchain.com/opentelemetry-langsmith/)
- [CVxTz/opentelemetry-langgraph-langchain-example](https://github.com/CVxTz/opentelemetry-langgraph-langchain-example)
- [Google Cloud — Instrument a LangGraph ReAct agent with OTel](https://docs.cloud.google.com/stackdriver/docs/instrumentation/ai-agent-langgraph)

### 7.5 Next.js / Edge runtime observability

- [Next.js OpenTelemetry guide](https://nextjs.org/docs/app/guides/open-telemetry)
- [Vercel Instrumentation](https://vercel.com/docs/tracing/instrumentation)
- [@vercel/otel on npm](https://www.npmjs.com/package/@vercel/otel)
- [Next.js Edge Runtime OTel limitations issue (#80445)](https://github.com/vercel/next.js/issues/80445)
- [Cloudflare Workers Exporting OTel Data](https://developers.cloudflare.com/workers/observability/exporting-opentelemetry-data/)
- [evanderkoogh/otel-cf-workers](https://github.com/evanderkoogh/otel-cf-workers)
- [RichiCoder1/opentelemetry-sdk-workers](https://github.com/RichiCoder1/opentelemetry-sdk-workers)
- [Cloudflare Workers tracing open beta (blog)](https://blog.cloudflare.com/workers-tracing-now-in-open-beta/)
- [Cloudflare AI Gateway — OpenTelemetry](https://developers.cloudflare.com/ai-gateway/observability/otel-integration/)

### 7.6 前端 observability

- [OpenTelemetry JS Browser Getting Started](https://opentelemetry.io/docs/languages/js/getting-started/browser/)
- [open-telemetry/opentelemetry-browser](https://github.com/open-telemetry/opentelemetry-browser)
- [OTel JS Instrumentation libraries](https://opentelemetry.io/docs/languages/js/libraries/)
- [Honeycomb: Observable Frontends — OTel in the Browser](https://www.honeycomb.io/blog/observable-frontends-opentelemetry-browser)
- [Honeycomb Browser JS docs](https://docs.honeycomb.io/send-data/javascript-browser)
- [Tracetest: Propagating OTel Context Browser → Backend](https://tracetest.io/blog/propagating-the-opentelemetry-context-from-the-browser-to-the-backend)
- [OTel JS Discussion #2209 — Frontend→Backend trace 不透传](https://github.com/open-telemetry/opentelemetry-js/discussions/2209)
- [Sentry JavaScript v8 OTel & Node Support (blog)](https://blog.sentry.io/sentry-javascript-v8-sdk-otel-and-node-support/)
- [Sentry OpenTelemetry Support](https://develop.sentry.dev/sdk/telemetry/traces/opentelemetry/)
- [Sentry OTLP ingestion](https://docs.sentry.io/concepts/otlp/)
- [@sentry/opentelemetry on npm](https://www.npmjs.com/package/@sentry/opentelemetry)
- [getsentry/sentry-javascript Discussion #7364 — Browser OTel 暂不投入](https://github.com/getsentry/sentry-javascript/discussions/7364)

### 7.7 Trace / Log / Metric 后端

- [grafana/docker-otel-lgtm](https://github.com/grafana/docker-otel-lgtm) — 单镜像 LGTM 体验
- [Grafana docs Docker OTel LGTM](https://grafana.com/docs/opentelemetry/docker-lgtm/)
- [grafana/otel-lgtm 一年回顾 (2025)](https://grafana.com/blog/2025/07/08/observability-in-under-5-seconds-reflecting-on-a-year-of-grafana/otel-lgtm/)
- [SigNoz Docker Standalone install](https://signoz.io/docs/install/docker/)
- [SigNoz Self-host overview](https://signoz.io/docs/install/self-host/)
- [SigNoz LangChain & LangGraph Observability with OTel](https://signoz.io/docs/langchain-observability/)
- [Honeycomb Distributed Tracing concept](https://docs.honeycomb.io/get-started/basics/observability/concepts/distributed-tracing)
- [Honeycomb for LLMs](https://docs.honeycomb.io/send-data/llm)
- [Sentry Self-hosted (Developer Docs)](https://develop.sentry.dev/self-hosted/)
- [getsentry/self-hosted](https://github.com/getsentry/self-hosted)

### 7.8 LLM 专用 trace / Eval

- [Langfuse Self-hosting overview](https://langfuse.com/self-hosting)
- [Langfuse Docker Compose deployment](https://langfuse.com/self-hosting/deployment/docker-compose)
- [Langfuse Migrate v2 → v3](https://langfuse.com/self-hosting/upgrade/upgrade-guides/upgrade-v2-to-v3)
- [Langfuse LangChain integration](https://langfuse.com/integrations/frameworks/langchain)
- [Langfuse OpenTelemetry / W3C Trace Context](https://langfuse.com/integrations/native/opentelemetry)
- [Langfuse Trace IDs & Distributed Tracing](https://langfuse.com/docs/observability/features/trace-ids-and-distributed-tracing)
- [Langfuse Trace and Evaluate LangGraph Agents (cookbook)](https://langfuse.com/guides/cookbook/example_langgraph_agents)
- [Langfuse LLM-as-a-Judge docs](https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge)
- [Langfuse LLM-as-a-Judge Execution Tracing (changelog 2025-10)](https://langfuse.com/changelog/2025-10-16-llm-as-a-judge-execution-tracing)
- [Langfuse LLM Evaluation 101 (2025-03)](https://langfuse.com/blog/2025-03-04-llm-evaluation-101-best-practices-and-challenges)
- [Langfuse vs LangSmith (Langfuse 官方对比)](https://langfuse.com/faq/all/langsmith-alternative)
- [LangSmith vs Langfuse — Mirascope hands-on](https://mirascope.com/blog/langsmith-vs-langfuse)
- [Langfuse vs LangSmith — ZenML 视角](https://www.zenml.io/blog/langfuse-vs-langsmith)
- [Arize Phoenix docs](https://arize.com/docs/phoenix)
- [Arize-ai/phoenix (GitHub)](https://github.com/Arize-ai/phoenix)

### 7.9 真实工程案例与方法论

- [Honeycomb: All the Hard Stuff Nobody Talks About when Building Products with LLMs](https://www.honeycomb.io/blog/hard-stuff-nobody-talks-about-llm)
- [Honeycomb: So We Shipped an AI Product. Did it Work?](https://www.honeycomb.io/blog/we-shipped-ai-product)
- [Honeycomb: Improving LLMs in Production With Observability](https://www.honeycomb.io/blog/improving-llms-production-observability)
- [Honeycomb: Using Honeycomb for LLM Application Development](https://www.honeycomb.io/blog/using-honeycomb-llm-application-development)
- [LangChain: On Agent Frameworks and Agent Observability](https://blog.langchain.com/on-agent-frameworks-and-agent-observability/)
- [LangSmith: Production Monitoring & Automations](https://blog.langchain.com/langsmith-production-logging-automations/)
- [LangChain State of AI 2024 Report](https://blog.langchain.com/langchain-state-of-ai-2024/)
- [Datadog: Native support for OTel GenAI semconv](https://www.datadoghq.com/blog/llm-otel-semantic-convention/)
- [Elastic: Tracing LangChain with OpenLLMetry + OTel](https://www.elastic.co/observability-labs/blog/elastic-opentelemetry-langchain-tracing)
- [VictoriaMetrics: AI Agents Observability with OTel](https://victoriametrics.com/blog/ai-agents-observability/)
- [CopilotKit: AG-UI Protocol](https://www.copilotkit.ai/ag-ui)
- [docs.copilotkit.ai AG-UI](https://docs.copilotkit.ai/learn/ag-ui-protocol)
- [Pragmatic Engineer: A pragmatic guide to LLM evals](https://newsletter.pragmaticengineer.com/p/evals)
- [Evidently AI: LLM-as-a-judge complete guide](https://www.evidentlyai.com/llm-guide/llm-as-a-judge)
- [Monte Carlo: LLM-As-Judge 7 Best Practices](https://www.montecarlodata.com/blog-llm-as-judge/)
- [arXiv 2411.13768: Evaluation-Driven Development & Operations of LLM Agents](https://arxiv.org/abs/2411.13768)
- [ZenML: What 1,200 Production LLM Deployments Reveal (2025)](https://www.zenml.io/blog/what-1200-production-deployments-reveal-about-llmops-in-2025)
- [Greptime: Agent Observability — Old Playbook vs New Game](https://www.greptime.com/blogs/2025-12-11-agent-observability) — 反方观点：传统三支柱在 agent 场景为何失效

---

## 文档维护

- 本文档与项目代码同生命周期演进。重大选型变更须新增 ADR 而非覆盖修改原 ADR。
- 每个 Phase 完成后回填实际工作量、踩坑、调整建议。
- v1（`docs/12-OBSERVABILITY-ARCHITECTURE.md`）保留作历史参考，标注 superseded by 22；不删除（用于追溯设计演进）。
- 涉及 experimental 标准（GenAI semconv / 浏览器 OTel SDK）的章节，每 6 个月复核一次版本与 breaking changes。
