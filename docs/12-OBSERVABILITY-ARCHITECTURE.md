# 12 - 可观测性与异常处理架构（v1，**已被 superseded**）

> ⚠️ **状态变更（2026-04-18）**：本文已被 [`22-OBSERVABILITY-ENTERPRISE.md`](./22-OBSERVABILITY-ENTERPRISE.md) **完全替代**。
>
> v1 选型基于"个人项目"假设（拒绝 OTel "太重"、拒绝 Langfuse "需自建服务"、拒绝 Sentry "单用户不需要"），与 agent-lab 实际定位"全栈企业级落地项目脚手架"不符。
>
> v2 在 v1 已落地工作（structlog、FastAPI 中间件、`agui_tracing`、LangSmith SDK 配置）基础上，重新选型 OpenTelemetry 全栈 + 三平面分立（trace/log/metric + LLM + Eval）+ 自托管栈（SigNoz + Langfuse + GlitchTip）。详见 v2 文档第 0 章"v1 → v2 演进的真实原因"。
>
> **本文保留作历史设计演进参考，新工作以 v2 为准。**
>
> ---
>
> 日期: 2026-04-14
> 状态: ❌ superseded by 22-OBSERVABILITY-ENTERPRISE.md
> 触发: Agent Chat tool call 事件流 bug，排查时发现系统零可观测性

## 1. 现状分析

### 1.1 当前问题

Agent Tab chat 发送消息时报错：

```
[CopilotKit] Agent error: Cannot send 'TOOL_CALL_START' event:
A tool call with ID 'call_6qsj4lgq' is already in progress.
Complete it with 'TOOL_CALL_END' first.
```

排查发现 7 层事件链路中**完全没有日志**，只有最末端 `@ag-ui/client` 的状态机校验报了一句错。等于盲飞。

### 1.2 事件链路（7 层）

```
LLM (ChatOpenAI)
  → LangGraph (astream_events, tool_call_chunks)
    → ag_ui_langgraph (状态机: TOOL_CALL_START/ARGS/END)
      → copilotkit Python (LangGraphAGUIAgent, 事件过滤/转换)
        → FastAPI SSE stream
          → Next.js BFF (CopilotRuntime, SSE passthrough)
            → @ag-ui/client (事件验证 ← 报错在这层)
              → CopilotKit React UI
```

`ag_ui_langgraph` 和 `copilotkit` 两层都处理 tool call 事件，靠命名前缀隔离（`"manually_emit_tool_call"` vs `"copilotkit_manually_emit_tool_call"`）。

### 1.3 异常处理现状

| 模式 | 频率 | 问题 |
|------|------|------|
| Silent Pass (`except: pass`) | ~15 处 | 隐藏真实错误 |
| 宽泛捕获 (`except Exception`) | ~35 处 | 掩盖 bug |
| 返回错误字典 (`{"error": str(e)}`) | ~20 处 | 无标准化，上下文丢失 |
| SSE 错误事件 | ~8 处 | 仅用于流式 API |
| `raise ValueError` | ~15 处 | 无自定义异常类 |

**关键缺失**：
- 零日志输出（`llm.py` 声明了 logger 但未使用）
- 零可观测性依赖（无 structlog/sentry/opentelemetry/langsmith）
- 零 LangChain callback 使用
- FastAPI 仅配置了 CORS 中间件
- 无请求 ID / 关联 ID 追踪

## 2. 架构设计

### 2.1 分层模型

```
┌─────────────────────────────────────────────────┐
│  L1  结构化日志         ← 基础设施，所有层共用       │
├─────────────────────────────────────────────────┤
│  L2  FastAPI 中间件     ← 请求级：耗时、错误、关联 ID  │
├─────────────────────────────────────────────────┤
│  L3  LLM 可观测性       ← LangChain/LangGraph 专用  │
├─────────────────────────────────────────────────┤
│  L4  AG-UI 事件追踪     ← 事件流级：tool call 序列    │
├─────────────────────────────────────────────────┤
│  L5  异常体系           ← 统一错误分类和传播          │
└─────────────────────────────────────────────────┘
```

### 2.2 技术选型

| 层 | 选型 | 理由 | 排除项 |
|---|---|---|---|
| **L1** 结构化日志 | **structlog** | LangChain 内部用 stdlib logging，structlog 无缝包装；支持上下文绑定（request_id, run_id）；dev 彩色 console / prod JSON 输出 | loguru（和 stdlib 集成差）、纯 stdlib（无结构化） |
| **L2** 请求中间件 | **FastAPI 原生** Middleware + exception_handler | 不需要额外库，FastAPI 内置机制足够 | — |
| **L3** LLM 可观测性 | **LangSmith** | 零代码侵入——设环境变量即全链路追踪；LangChain 生态原生工具；UI 可回放 agent 执行过程 | Langfuse（需自建服务）、OpenTelemetry（太重）|
| **L4** AG-UI 事件追踪 | **LangChain Callback** + `_dispatch_event` wrapper | 没有现成方案，需薄层拦截记录 TOOL_CALL 事件序列 | — |
| **L5** 异常体系 | **自定义 Exception 层级** | FastAPI 标准做法 | — |

### 2.3 选型决策记录

**为什么选 structlog 而不是 loguru？**

- LangChain、LangGraph、uvicorn 内部都用 stdlib `logging`
- structlog 设计为 stdlib logging 的增强层，可以同时捕获第三方库日志
- loguru 是独立日志系统，和 stdlib logging 是两套体系，需要额外桥接
- structlog 的 `bind()` 上下文传播机制适合请求级别的关联 ID 追踪

**为什么选 LangSmith 而不是 Langfuse / OpenTelemetry？**

- LangSmith 是 LangChain 官方 tracing，对 LangGraph 支持最好
- 零代码侵入：设 3 个环境变量（`LANGSMITH_API_KEY`、`LANGSMITH_PROJECT`、`LANGSMITH_TRACING`）即可
- 自动追踪：LLM input/output、token 用量、tool_call_chunks 完整序列、ReAct 循环
- 学习价值：理解 LangChain 生态的标准可观测性方案
- Langfuse 需要自建服务（Docker），增加运维负担
- OpenTelemetry 是通用分布式追踪，对 LLM 特定场景（prompt、token、tool call）支持弱

**为什么不加 Sentry？**

- 单用户项目，错误不需要聚合/告警/分配
- structlog + LangSmith 已经覆盖了日志和 LLM 追踪
- 后续需要时可以加，structlog 有 Sentry 集成

## 3. 各层详细设计

### 3.1 L1: structlog 结构化日志

**配置位置**: `agents/shared/src/agent_lab_shared/logging.py`（新建）

**设计要点**:
- 项目启动时调用一次 `setup_logging()`，配置 structlog + stdlib logging
- dev 环境：`ConsoleRenderer`（彩色、人类可读）
- prod 环境：`JSONRenderer`（机器可解析）
- 全局上下文绑定：`agent_id`、`deploy_env`
- 请求级上下文：`request_id`、`run_id`（通过 contextvars）

**日志级别规范**:
| 级别 | 用途 |
|------|------|
| ERROR | 需要人工介入的失败（LLM 调用失败、持久化失败） |
| WARNING | 可自恢复的异常（单条数据解析失败、重试） |
| INFO | 关键业务节点（请求开始/结束、pipeline 阶段、tool call 开始/结束） |
| DEBUG | 开发调试（LLM 原始响应、事件流详情） |

### 3.2 L2: FastAPI 中间件

**请求日志中间件**:
```
请求进入
  → 生成 request_id (uuid4)
  → structlog.bind(request_id=...)
  → INFO: 记录 method, path
  → 执行处理
  → INFO: 记录 status_code, duration_ms
```

**全局异常处理器**:
- `RadarError` → 对应 HTTP status + 结构化错误体
- `Exception` → 500 + ERROR 日志 + traceback

**SSE 端点特殊处理**:
- 流中断 → WARNING 日志
- 业务错误 → 错误事件 + ERROR 日志（取代现在的静默 pass）

### 3.3 L3: LangSmith

**配置方式**: 环境变量（`.env`）

```
LANGSMITH_API_KEY=lsv2_...
LANGSMITH_PROJECT=radar
LANGSMITH_TRACING=true
```

**自动获得的追踪**:
- 每次 LLM 调用：input messages、output、token 用量、latency
- tool_call_chunks 完整序列 ← 直接定位当前 bug 根因
- ReAct agent 每轮循环（LLM → tool → LLM）
- LangSmith UI 可视化回放

**与 structlog 的关系**: 互补，不重叠
- LangSmith：LLM 内部细节（prompt、token、model 行为）
- structlog：应用级日志（请求、业务逻辑、错误）

### 3.4 L4: AG-UI 事件追踪

**目的**: 追踪 LangGraph → AG-UI → 前端 这段 LangSmith 覆盖不到的链路。

**实现方式**: 包装 `LangGraphAGUIAgent`，在 `_dispatch_event` 中拦截 TOOL_CALL 事件。

**记录内容**:
- 每个 `TOOL_CALL_START`：tool_call_id, tool_call_name, timestamp
- 每个 `TOOL_CALL_END`：tool_call_id, timestamp
- 检测异常序列：连续两个 START 无 END、orphaned END

**日志级别**: DEBUG（正常流程）/ WARNING（异常序列）

### 3.5 L5: 异常体系

```python
class RadarError(Exception):
    """Radar Agent 基础异常"""
    def __init__(self, message: str, *, context: dict | None = None):
        super().__init__(message)
        self.context = context or {}

class CollectorError(RadarError):
    """数据采集失败（网络超时、解析错误、API 限流）"""

class EvaluationError(RadarError):
    """LLM 评判失败（模型错误、响应解析失败）"""

class PlatformAPIError(RadarError):
    """BFF 平台 API 通信失败"""

class ConfigurationError(RadarError):
    """配置缺失或无效"""
```

**使用规范**:
- 所有 `except Exception` 替换为具体异常类型
- 异常抛出时附带 `context` 字典（raw_item_id、source_id 等）
- 异常捕获时用 structlog 记录，不再静默 pass
- tool 函数返回的 `{"error": ...}` 保留（LangChain tool 约定），但同时 logger.error

## 4. 实施优先级

| 优先级 | 层 | 工作量 | 收益 |
|--------|---|--------|------|
| **P0** | L3 LangSmith | 10 分钟（设环境变量） | 立即看到 tool_call 完整链路，定位当前 bug |
| **P1** | L1 structlog | 1-2 小时 | 基础设施就绪，所有后续工作依赖它 |
| **P2** | L5 异常体系 | 1-2 小时 | 统一错误处理，消除 silent pass |
| **P3** | L2 FastAPI 中间件 | 1 小时 | 请求级日志和错误处理 |
| **P4** | L4 AG-UI 事件追踪 | 30 分钟 | 如果 LangSmith 不够再加 |

## 附录

### A. structlog

- 官方文档: https://www.structlog.org/en/stable/
- FastAPI 集成: https://www.structlog.org/en/stable/frameworks.html
- stdlib logging 桥接: https://www.structlog.org/en/stable/standard-library.html
- 上下文绑定 (contextvars): https://www.structlog.org/en/stable/contextvars.html

### B. LangSmith

- 官方文档: https://docs.smith.langchain.com/
- 快速开始: https://docs.smith.langchain.com/observability/how_to_guides/setup
- LangGraph 集成: https://docs.smith.langchain.com/observability/how_to_guides/trace_with_langgraph
- Pricing: https://www.langchain.com/pricing (Developer 免费, 5000 traces/月)

### C. FastAPI 异常处理

- Exception Handlers: https://fastapi.tiangolo.com/tutorial/handling-errors/
- Middleware: https://fastapi.tiangolo.com/tutorial/middleware/
- Custom Exception Handlers: https://fastapi.tiangolo.com/tutorial/handling-errors/#install-custom-exception-handlers

### D. LangChain Callbacks

- 概念文档: https://python.langchain.com/docs/concepts/callbacks/
- 自定义 Callback Handler: https://python.langchain.com/docs/how_to/custom_callbacks/
