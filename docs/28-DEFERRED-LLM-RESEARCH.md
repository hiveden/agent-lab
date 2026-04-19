# 28 - DeferredLLM 替代方案调研报告

> **定位**：Phase 5#2 对照实验证明"AG-UI 事件双发"根因是 `DeferredLLM`（`BaseChatModel` 子类包装器）+ LangGraph `astream_events` 组合效应后，对该架构的替代方案所做的业内最佳实践调研。本文是**纯调研**，决策记录见 [`22` ADR-011](./22-OBSERVABILITY-ENTERPRISE.md#adr-011)。
>
> **相关文档**：
> - 问题定位：[`17-AGUI-STREAMING-DEDUP.md`](./17-AGUI-STREAMING-DEDUP.md)
> - 对照实验：本文 §3
> - 架构决策：[`22-OBSERVABILITY-ENTERPRISE.md` ADR-011](./22-OBSERVABILITY-ENTERPRISE.md#adr-011)
> - 重构工单：[GitHub issues label:debt + agent](https://github.com/hiveden/agent-lab/issues?q=is%3Aopen+label%3Adebt+label%3Aagent)
>
> **调研日期**：2026-04-19
> **项目**：agent-lab（LangGraph 1.x + ag-ui-langgraph 0.0.32/0.0.33 + CopilotKit 0.1.86）
> **目标代码**：`agents/shared/src/agent_lab_shared/llm.py` L105-203（`DeferredLLM` class）

---

## 1. 问题定义

### 1.1 现状

`DeferredLLM` 是一个 `BaseChatModel` 子类，外层薄壳，内层每次 `_astream` / `_generate` 调用时通过 `get_llm(task)` 临时构造一个 `ChatOpenAI` 实例。其目的是让用户在 Settings UI 修改 LLM 配置后**无需重启 agent server 即可立即生效**。

### 1.2 代价清单

| 代价 | 触发路径 | 量级 |
|---|---|---|
| **双层 BaseChatModel** | `DeferredLLM._astream` → `ChatOpenAI._astream`，两层都是 `BaseChatModel`，LangGraph `astream_events` 对每个 token 触发两次 `on_chat_model_stream` | 所有 token × 2 |
| **HTTP client / 连接池丢失** | `_create_llm` 每次 `httpx.Client(trust_env=False)` | 每请求 1 次 TCP + TLS 握手 |
| **每请求查 DB settings** | `PlatformClient().get_llm_settings()` 走 HTTP 到 BFF | 每请求 1 次 HTTP RTT（本地 <10ms，但阻塞在 `_get_runnable` 路径）|
| **Callback manager 双触发** | LangChain callback 对所有观测后端双发 | Langfuse trace / OTel span 全翻倍 |
| **补丁层永久驻留** | `observability/repair.py` 中的 `agui_tracing` 去重补丁 | 一个 repo 内隐性债务 |

### 1.3 产品约束

- 必须在用户改 Settings 后 **<2s** 内生效（无需重启）
- 单用户多设备，**无并发压力**
- 只有 3 个 task 档：`push` / `chat` / `tool`
- Provider 都走 OpenAI-compatible API（`base_url` 切 GLM / Ollama / Grok / OpenAI）

---

## 2. 候选方案详评

### 方案 A：`init_chat_model` + `configurable_fields` + `config_prefix`（LangChain 官方原生）

#### 2.A.1 机制

LangChain 官方在 `langchain.chat_models.base.init_chat_model` 提供了 `_ConfigurableModel` 包装器——**它不是 `BaseChatModel` 子类，而是 `Runnable` 的 proxy**。它在每次 `invoke/stream` 时：

1. 合并默认参数 + `config["configurable"]` 运行时参数
2. 用 `_init_chat_model_helper` 实例化底层 `BaseChatModel`
3. 重放 `bind_tools` / `with_structured_output` 等 deferred 操作
4. 把调用 forward 给该 `BaseChatModel`

```python
from langchain.chat_models import init_chat_model

llm = init_chat_model(
    configurable_fields=("model", "model_provider", "api_key", "base_url", "temperature"),
    config_prefix="llm",
)

# 每次请求传运行时配置
await llm.ainvoke(
    messages,
    config={"configurable": {
        "llm_model": "glm-4.5-flash",
        "llm_model_provider": "openai",  # openai-compatible
        "llm_api_key": db_settings.api_key,
        "llm_base_url": db_settings.base_url,
    }},
)
```

#### 2.A.2 热更新能力

**完美**。每次 invoke/stream 都读新 config，改完 DB 立即生效（延迟 = 下次请求 = 0）。

#### 2.A.3 成本

- **底层 `BaseChatModel` 每次重建** —— 与 DeferredLLM 等价，仍然丢 HTTP client。
- **但**：`_ConfigurableModel` 不是 `BaseChatModel`，`on_chat_model_stream` **不会在 proxy 层触发**，只在底层真实 LLM 触发一次。

#### 2.A.4 是否解决双层问题

**✅ 解决**。Proxy 是纯 Runnable（`RunnableSerializable`），不是 `BaseChatModel`。LangChain callback 机制只对 `BaseChatModel._astream/_stream/_agenerate/_generate` 分发 `on_chat_model_*` 事件；而 `_ConfigurableModel.invoke` 内部走的是底层 LLM 的 `invoke`（也就是一次完整 callback 路径），proxy 自己不再额外发射 `on_chat_model_stream`。

这正是 DeferredLLM 踩坑的根因：**DeferredLLM 选择 override `_astream` 并走 `BaseChatModel._astream` 路径**，所以 LangChain callback manager 在 DeferredLLM 层先 emit 一次 `on_chat_model_start/stream/end`，然后底层 `ChatOpenAI._astream` 又 emit 一次。官方 `_ConfigurableModel` 通过「在 Runnable 层拦截」避开了这个 BaseChatModel callback 路径。

#### 2.A.5 代码示例

完整最小替换（假想，不实施）：

```python
# agents/shared/src/agent_lab_shared/llm.py
from langchain.chat_models import init_chat_model

_BASE_LLM = init_chat_model(
    configurable_fields=("model", "api_key", "base_url"),
    config_prefix="llm",
    temperature=0.7,
    model_provider="openai",  # 固定 openai-compatible
)

def get_llm(task):
    # 返回同一个 _ConfigurableModel 实例，不再每次构造
    return _BASE_LLM

# Graph node 层把 task-specific config 注入 runnable config
async def chat_node(state, config):
    s = await resolve_settings_async(config.get("configurable", {}).get("task", "chat"))
    return await _BASE_LLM.ainvoke(
        state["messages"],
        config={"configurable": {
            "llm_model": s.model,
            "llm_api_key": s.api_key,
            "llm_base_url": s.base_url,
        }},
    )
```

注意：**底层 LLM 实例仍然每次重建**（`_init_chat_model_helper` 内部 `ChatOpenAI(**params)`），HTTP client 复用问题仍在——除非组合「方案 C：实例缓存」。

#### 2.A.6 生态证据

- 官方 API 参考：https://reference.langchain.com/python/langchain/chat_models/base/init_chat_model
- 官方 how-to：https://python.langchain.com/docs/how_to/configure/（已 301 到 docs.langchain.com）
- 官方警告：`configurable_fields="any"` 允许 api_key/base_url 被运行时覆盖，多租户要显式枚举避免被劫持
- **LangGraph Platform Assistants 的 `assistant.config.configurable` 正是这个机制**——一个 graph 多个 assistant，每个 assistant 带自己的 model config，用来做多租户和 A/B
- 来源：https://docs.langchain.com/langsmith/assistants

---

### 方案 B：LangGraph `RunnableConfig.configurable` + node 内显式选 LLM（官方推荐）

#### 2.B.1 机制

LangGraph 1.x 官方推荐的"动态配置"模式：**在 node 函数签名里声明 `Runtime[ContextSchema]` 或 `RunnableConfig`**，node 内部从 context/config 读出 model 标识，从**预构建的 LLM 字典**里挑一个。

```python
# 官方 use-graph-api 文档原文示例
from dataclasses import dataclass
from langchain.chat_models import init_chat_model
from langgraph.runtime import Runtime

@dataclass
class ContextSchema:
    model_provider: str = "anthropic"

MODELS = {
    "anthropic": init_chat_model("claude-haiku-4-5-20251001"),
    "openai": init_chat_model("gpt-4.1-mini"),
}

def call_model(state: MessagesState, runtime: Runtime[ContextSchema]):
    model = MODELS[runtime.context.model_provider]
    response = model.invoke(state["messages"])
    return {"messages": [response]}
```

同样适用于 `create_react_agent`：`model` 参数直接接收 `Callable[[state, runtime], BaseChatModel]`：

```python
def select_model(state, runtime):
    return MODELS[runtime.context.model_name].bind_tools(tools)

agent = create_react_agent(model=select_model, tools=tools)
```

来源：https://reference.langchain.com/python/langgraph.prebuilt/chat_agent_executor/create_react_agent

#### 2.B.2 热更新能力

**中等**。预构建的 `MODELS` 字典里实例是**冷的**——DB settings 改了之后，如果 key 已经存在（如 `"openai"`），**新的 api_key/base_url 不会进 dict**。需要：

1. **运行时重建** dict（每请求重构，退化到 DeferredLLM）
2. **监听 settings 变更**（SSE/polling）清缓存并重建
3. **放弃预构建**，node 内 `init_chat_model(**runtime.context.llm_params)` 每次新建

#2 是正解，但实施成本 = 方案 C。#3 退化到方案 A。

#### 2.B.3 成本

纯 node-level 方案 —— 每请求 1 次 dict lookup（O(1)），**零 overhead**，前提是 dict 是静态的。

#### 2.B.4 是否解决双层问题

**✅ 解决**。`call_model` node 里直接用 `model.invoke`，没有 wrapper 层。`on_chat_model_stream` 只在真实 LLM 触发一次。

#### 2.B.5 代码示例

见 2.B.1。

#### 2.B.6 生态证据

- LangGraph 官方 use-graph-api 文档："Add runtime configuration" 章节：https://docs.langchain.com/oss/python/langgraph/use-graph-api#add-runtime-configuration
- LangGraph Discussion #2111："How to add runtime configuration to create_react_agent"
  （URL https://github.com/langchain-ai/langgraph/discussions/2111 调研时 404，但结论已被官方吸收进 `create_react_agent` 的 `model: Callable` 签名）
- Medium 实战：https://medium.com/fundamentals-of-artificial-intelligence/langgraph-dynamic-runtime-configuration-6799ddd357a3

---

### 方案 C：内存缓存 LLM 实例 + 版本号 invalidation（自研，业内通用 pattern）

#### 2.C.1 机制

模块级 dict 缓存 `(provider, base_url, model, api_key_hash) -> ChatOpenAI` 实例。Settings 变更时**主动失效**——不是每请求查 DB，而是：

- 在 BFF 的 `PUT /api/settings` 成功后**主动推**一个 webhook 给 Python，Python 清缓存
- 或 Python 轮询 `/api/settings/version`（只返回一个 timestamp/hash），命中时清缓存
- 或用 Redis pub/sub / SSE

```python
# 伪实现
_llm_cache: dict[tuple, BaseChatModel] = {}
_settings_version: str = ""

def get_llm(task: str) -> BaseChatModel:
    global _settings_version
    current_version = platform_client.get_settings_version()  # 只返 hash
    if current_version != _settings_version:
        _llm_cache.clear()
        _settings_version = current_version

    s = _resolve_settings(task)
    key = (s.provider, s.base_url, s.model, hashlib.sha256(s.api_key.encode()).hexdigest())
    if key not in _llm_cache:
        _llm_cache[key] = _create_llm(*s)
    return _llm_cache[key]
```

更优：BFF 在设置变更时主动 `POST http://agent:8001/internal/reload-settings`，Python 端 handler 仅 `_llm_cache.clear()`。

#### 2.C.2 热更新能力

- Push 模式：<100ms（一次 HTTP）
- Pull 模式：取决于 poll 间隔（1-2s 可接受）

#### 2.C.3 成本

缓存命中时**零开销**——不 rebuild LLM，不 rebuild HTTP client，连接池全程复用。Miss 时一次性成本。

#### 2.C.4 是否解决双层问题

**✅ 解决**（前提：`get_llm` 直接返回 `ChatOpenAI` 实例，不再包 `DeferredLLM`）。

#### 2.C.5 代码示例

见 2.C.1。关键是**移除 `DeferredLLM` 这个 BaseChatModel 包装**，`get_llm` 直接返回已缓存的 `ChatOpenAI`。

#### 2.C.6 生态证据

- 没有 LangChain 官方文档直接讲这个 pattern
- 但这是 **Python server 的通用 cache-invalidation 惯例**，FastAPI/Flask 社区案例很多
- **Mastra 的做法本质上就是这个**：`model` 可以是一个函数 `(context) => "${provider}/${model}"`，字符串直接查预缓存的 provider registry（https://mastra.ai/docs/models，https://mastra.ai/en/docs/frameworks/agentic-uis/ai-sdk）
- Langfuse/LangSmith 自己的系统走 **"prompt + model config 耦合版本"**——本质是另一种 invalidation（版本号），而不是 wrapper

---

### 方案 D：Reload endpoint / SIGHUP 模式（进程级热更）

#### 2.D.1 机制

- Python agent 暴露 `POST /internal/reload`，handler 里 `global _cached_llm; _cached_llm = None`
- 或监听 `SIGHUP`：`signal.signal(signal.SIGHUP, reload_handler)`
- BFF 在 settings 变更时调用这个 endpoint（和方案 C push 模式是同一件事的两种包装）

#### 2.D.2 热更新能力

<100ms（HTTP 调用时间）。

#### 2.D.3 成本

同方案 C。差异在**可见性**：reload endpoint 写在 HTTP 接口而不是缓存层，运维更好查。

#### 2.D.4 是否解决双层问题

**✅ 解决**（同方案 C 前提）。

#### 2.D.5 代码示例

```python
from fastapi import APIRouter
router = APIRouter()

@router.post("/internal/reload-llm")
async def reload_llm():
    llm_cache.clear()
    return {"ok": True}
```

BFF 侧在 `PUT /api/settings` 成功后：

```ts
await fetch(`${AGENT_BASE}/internal/reload-llm`, { method: "POST" });
```

#### 2.D.6 生态证据

- Uvicorn/Gunicorn 官方支持 SIGHUP graceful restart：https://www.uvicorn.org/deployment/
- 不是 LangChain 专属 pattern，是 **WSGI/ASGI 通用 ops 做法**
- Prefab 等动态 config 服务（https://prefab.cloud/blog/dynamic-logging-in-fastapi-with-python/）提供商业化封装

---

### 方案 E：进程重启（`uvicorn --reload` / docker 重启）

#### 2.E.1 机制

BFF 改 settings 后，触发 Python 进程重启（docker restart / supervisor signal / uvicorn file-watch）。

#### 2.E.2 热更新能力

- `uvicorn --reload` watch 文件变动：需要 settings 改动落盘到某个 .py 或 .env（hacky）
- Docker restart：3-10s 冷启动（LangGraph 初始化慢）
- **不满足 <2s 要求**

#### 2.E.3 成本

进程冷启 = 所有 imports + LangGraph 编译 = 通常 1-5s。不适合用户级操作。

#### 2.E.4 是否解决双层问题

**✅ 解决**（get_llm 可以写成最简单的模块级单例）。

#### 2.E.5 代码示例

略（运维方案，非代码方案）。

#### 2.E.6 生态证据

社区普遍做法，但**没人用在"用户改配置立即生效"的产品需求上**——用户体验太差。

---

### 方案 F：请求级配置注入（client 每请求携带 config header）

#### 2.F.1 机制

CopilotKit 前端在每次请求里带上 `forwardedProps: { llm: {...} }`，BFF 透传给 Python，Python 在 `LangGraphAGUIAgent` 的 `RunAgentInput.forwardedProps` 里提取，注入到 `graph.ainvoke(..., context=...)`。

#### 2.F.2 热更新能力

**完美**，每次请求带最新配置，改完立即生效（前提：前端能读到最新 settings，比如 SWR invalidate 后的 Zustand store 值）。

#### 2.F.3 成本

零额外后端成本，但**把 api_key 等敏感数据从前端一路传到后端**——安全问题。

#### 2.F.4 是否解决双层问题

**✅ 解决**（和方案 B 组合使用，node 里直接 `init_chat_model(**context.llm_params)`）。

#### 2.F.5 代码示例

前端：

```ts
<CopilotKit ... forwardedProps={{ llm: llmSettingsFromStore }}>
```

Python node：

```python
def call_model(state, runtime):
    llm_params = runtime.context.llm
    llm = init_chat_model(**llm_params)
    return {"messages": [llm.invoke(state["messages"])]}
```

#### 2.F.6 生态证据

- LangGraph Platform Assistants 本质就是这个（https://docs.langchain.com/langsmith/assistants）——每个 assistant 带一份 config，invoke 时合进 runnable config
- CopilotKit AG-UI forwardedProps：ag-ui-langgraph 0.0.33 支持（https://pypi.org/project/ag-ui-langgraph/）
- **安全风险**：把 api_key 走前端→后端不是主流做法，通常只传 `assistant_id`，后端自己查 DB

---

## 3. 官方推荐对照

### 3.1 LangChain 官方（`init_chat_model`）

**推荐方案 A**，但仅当需要 per-request 动态切 model/provider 且不介意底层 LLM 每次重建。官方在文档里明确说这是"chat model emulator that initializes the underlying model at runtime once a config is passed in"——设计目的就是覆盖动态配置场景。

### 3.2 LangGraph 官方（1.x）

**推荐方案 B**（`Runtime[ContextSchema]` + 预建 model dict），作为 `create_react_agent` 的 `model: Callable` 签名的使用范式。官方文档示例里 `MODELS = {"anthropic": ..., "openai": ...}` 是冷缓存——**官方并没有直接解决"配置热更"问题**，而是假设部署时配置已固定，运行时只是在已知选项间切换。

### 3.3 LangChain 1.x `create_agent` + middleware（2026 新）

`wrap_model_call` middleware 是官方最新推荐的"swap model mid-task"机制：

```python
from langchain.agents.middleware import wrap_model_call

@wrap_model_call
def dynamic_model(request, handler):
    request.model = get_llm_from_cache(request.context.get("task"))
    return handler(request)

agent = create_agent(model=default_model, tools=tools, middleware=[dynamic_model])
```

来源：https://blog.langchain.com/agent-middleware/, https://reference.langchain.com/python/langchain/middleware

**这是迁移 LangChain 1.x 后的新首选**——但 agent-lab 当前用的是 LangGraph `create_react_agent`（未迁 `create_agent`），暂不适用。

### 3.4 生态对比表

| 生态 | 动态 LLM 机制 | 热更 DB 配置 |
|---|---|---|
| LangChain Classic | `init_chat_model(configurable_fields=...)` | ✅ via runtime config |
| LangGraph Platform Assistants | assistant.config.configurable | ✅ via 更新 assistant version |
| LangChain 1.x create_agent | `wrap_model_call` middleware | ✅ 自己在 middleware 查缓存 |
| CopilotKit AG-UI | forwardedProps → context/configurable | ✅ 前端每请求带 |
| Mastra | `model: (ctx) => string` dynamic function | ✅ 字符串查 registry |
| Vercel AI SDK | 每请求直接 `new OpenAI({apiKey})` | ✅ 无状态 |
| AutoGen | `config_list` 列表轮询 | ❌ 启动时固定 |
| CrewAI | Agent(llm=...) 构造时固定 | ❌ 需要重建 Agent |
| LlamaIndex | `Settings.llm = ...` 全局 | ⚠️ 全局可变但非 per-request |

---

## 4. 最终推荐排名

### 排名

| 名次 | 方案 | 一句话评价 |
|---|---|---|
| 🥇 1 | **方案 C：内存缓存 + push invalidation** | 最匹配 agent-lab 约束：零请求开销 + 立即生效 + 解决双层 + 代码量最少 |
| 🥈 2 | **方案 A：`init_chat_model` configurable_fields** | 官方原生，代码优雅，但底层每次重建 HTTP client 未解决 |
| 🥉 3 | **方案 C + 方案 B 组合** | LangGraph-idiomatic 的长期方案，但过度工程 |
| 4 | 方案 D：reload endpoint | 和方案 C 等价，只是入口不同 |
| 5 | 方案 F：forwardedProps | 把 api_key 暴露给前端，安全不可接受 |
| 6 | 方案 E：进程重启 | 不满足 <2s 约束 |

### 首选方案：C（缓存 + push invalidation）详论

**为什么选 C：**

1. **解决双层问题**：`get_llm` 直接返回 `ChatOpenAI`（cache hit）或新建 `ChatOpenAI`（cache miss），不再包 `DeferredLLM`。LangGraph astream_events 一层 callback。`observability/repair.py` 的补丁可以摘掉（需验证）。
2. **立即生效**：BFF 在 `PUT /api/settings` 成功后同步 `POST /internal/reload-llm`（<50ms，本地回环）。如果这个 HTTP 失败，fallback 到 TTL=2s 的 pull 兜底（偶发漏推时 2s 后自动恢复）。
3. **零请求开销**：缓存命中时 HTTP client、连接池、TLS session 全复用。对比当前 DeferredLLM：每请求省 1 次 DB 查询（5-10ms）+ 1 次 httpx.Client 构造 + TLS 握手（首次 50-200ms，但 keep-alive 后复用）。
4. **代码量**：`llm.py` 能从 203 行缩到 ~60 行。去掉 `DeferredLLM` class 全部 + `_get_runnable` + 双 `_astream/_stream/_generate` + `bind_tools` override。
5. **单用户多设备**：无并发，缓存用最朴素的 `dict` 即可，不需要 `threading.Lock`/`asyncio.Lock`。
6. **Task 档只有 3 个**：缓存 size 最多 3，清缓存成本近零。
7. **Settings 版本号**：BFF 侧 `settings` 表加一列 `updated_at` 或维护一个全局 `settings_version`，Python pull 时只比对 hash，99% 请求命中缓存。

**为什么不选 A（`init_chat_model`）：**

- 底层 `ChatOpenAI` 每次重建（官方 `_init_chat_model_helper` 内部 `ChatOpenAI(**params)`），HTTP 连接池丢失问题**原封不动**。只解决了一半。
- 要同时解决连接池，还得再套一层缓存，等于方案 A + 方案 C——复杂度超过纯方案 C。
- 方案 A 的 proxy 有一层 Runnable overhead（deferred operations 重放），观测上虽然不 emit `on_chat_model_stream`，但会 emit `on_chain_start/end` 的 Runnable 事件——**需要验证是否干扰 ag-ui-langgraph**。

**为什么不选 B（node 内选 LLM）：**

- 需要改动 graph 结构（`create_react_agent(model=callable)` 或 node 签名），比在 `get_llm` 里改动侵入更大。
- agent-lab 有 3 个 task 档（`push/chat/tool`），每个 task 有自己的调用点。方案 B 要求每个调用点都从 runtime 里拿配置，散落修改多。
- LangGraph 1.x 的 context/config 传递到 LangChain tools 的内部 LLM 调用需要显式 propagate，容易漏。

**验证清单**（选方案 C 后必做）：

- [ ] 移除 `DeferredLLM` 后，`astream_events` 确认每 token **只触发一次** `on_chat_model_stream`
- [ ] 移除 `observability/repair.py` 的 `agui_tracing` 去重补丁后，ag-ui-langgraph 的 `TEXT_MESSAGE_START/CONTENT/END` 和 `TOOL_CALL_START/ARGS/END` 不再双发
- [ ] Langfuse trace 不再看到双份 LLM span
- [ ] Settings 改动后 reload endpoint 被调用，下一次 agent invoke 使用新配置

---

## 5. 参考资料

### LangChain 官方

- [init_chat_model API reference](https://reference.langchain.com/python/langchain/chat_models/base/init_chat_model)
- [init_chat_model v0.3 docs](https://reference.langchain.com/v0.3/python/langchain/chat_models/langchain.chat_models.base.init_chat_model.html)
- [init_chat_model latest API](https://python.langchain.com/api_reference/langchain/chat_models/langchain.chat_models.base.init_chat_model.html)
- [LangChain Overview (configurable redirect)](https://docs.langchain.com/oss/python/langchain/overview)
- [ChatOpenAI reference](https://reference.langchain.com/python/langchain-openai/chat_models/base/ChatOpenAI)
- [BaseChatModel reference](https://reference.langchain.com/python/langchain-core/language_models/chat_models/BaseChatModel)

### LangGraph 官方

- [Add runtime configuration (use-graph-api)](https://docs.langchain.com/oss/python/langgraph/use-graph-api)
- [create_react_agent reference](https://reference.langchain.com/python/langgraph.prebuilt/chat_agent_executor/create_react_agent)
- [LangGraph Platform Assistants](https://docs.langchain.com/langsmith/assistants)
- [Custom Authentication and Access Control for LangGraph Platform](https://blog.langchain.com/custom-authentication-and-access-control-in-langgraph/)
- [LangGraph 1.x milestone announcement](https://www.langchain.com/blog/langchain-langgraph-1dot0)

### LangChain 1.x create_agent / Middleware

- [Agent Middleware (blog)](https://blog.langchain.com/agent-middleware/)
- [create_agent reference](https://reference.langchain.com/python/langchain/agents/factory/create_agent)
- [middleware reference](https://reference.langchain.com/python/langchain/middleware)
- [How Middleware Lets You Customize Your Agent Harness](https://www.langchain.com/blog/how-middleware-lets-you-customize-your-agent-harness)

### 双发/callback 相关 bug

- [Issue #22227: astream_events gives duplicate content in on_chat_model_stream](https://github.com/langchain-ai/langchain/issues/22227)
- [Issue #19211: astream_event produces redundant tokens](https://github.com/langchain-ai/langchain/issues/19211)
- [LangGraph Issue #78: Stream Chat LLM Token By Token](https://github.com/langchain-ai/langgraph/issues/78)

### AG-UI / CopilotKit

- [ag-ui-langgraph PyPI 0.0.33](https://pypi.org/project/ag-ui-langgraph/)
- [CopilotKit LangGraph docs](https://docs.copilotkit.ai/langgraph/)
- [CopilotKit LangGraph concepts](https://docs.copilotkit.ai/langgraph/concepts/langgraph)
- [Building an Agent Chat UI with AG-UI, FastAPI, and LangGraph](https://medium.com/data-science-collective/building-an-agent-chat-ui-with-ag-ui-fastapi-and-langgraph-7404fcbd8f9b)
- [Issue #110: ag-ui working with langgraph (authorization header)](https://github.com/ag-ui-protocol/ag-ui/issues/110)

### 其他生态

- [Mastra Models docs](https://mastra.ai/models)
- [Mastra Model Configuration Patterns](https://deepwiki.com/mastra-ai/mastra/5.2-project-configuration)
- [Vercel AI SDK](https://ai-sdk.dev/docs/introduction)
- [Langfuse LLM Connections](https://langfuse.com/docs/administration/llm-connection)
- [LangSmith Model Configurations](https://docs.langchain.com/langsmith/model-configurations)

### 部署 / Reload

- [Uvicorn Deployment (SIGHUP)](https://www.uvicorn.org/deployment/)
- [Dynamic Logging in FastAPI](https://prefab.cloud/blog/dynamic-logging-in-fastapi-with-python/)
- [Zero Downtime FastAPI Deployments](https://medium.com/@connect.hashblock/achieving-zero-downtime-fastapi-deployments-with-gunicorn-uvicorn-workers-and-health-probes-f169bdd524eb)

### 配套案例

- [LangGraph Dynamic Runtime Configuration (Medium)](https://medium.com/fundamentals-of-artificial-intelligence/langgraph-dynamic-runtime-configuration-6799ddd357a3)
- [Langfuse LangChain Integration](https://langfuse.com/integrations/frameworks/langchain)
- [Langfuse Prompt Config Coupling (Discussion #8145)](https://github.com/orgs/langfuse/discussions/8145)

---

## 附：对 DeferredLLM 现状的诚实评价

DeferredLLM **不属于**任何一种业内主流 pattern。最接近的是 LangChain 官方 `_ConfigurableModel`（方案 A），但有两个关键差异：

1. `_ConfigurableModel` 继承自 `RunnableSerializable` 而不是 `BaseChatModel` ← **这是避开双 callback 的关键**
2. `_ConfigurableModel` 不 override `_astream/_stream/_generate`，而是 override Runnable 的 `invoke/stream/ainvoke/astream` ← 直接走下层 runnable 的入口，callback 路径只跑一次

DeferredLLM 的设计错误在于**选择了 `BaseChatModel` 作为基类**并 override `_astream` 这些"LLM 专有"hook。这使得它在 LangChain callback dispatch 系统里被当作真正的 LLM 记录一次 `on_chat_model_*`，然后内部委托的 `ChatOpenAI` 又记录一次。

如果要保留 DeferredLLM 的形态但修好双发，**正确的 LangChain 官方做法**是改为 Runnable proxy（继承 `RunnableSerializable`，override `invoke/stream/ainvoke/astream`，不 override `_astream` 等 BaseChatModel 专有 hook）——这本质上就是重写成 `_ConfigurableModel` 的变体。但既然方案 C 代码更少、收益更高、语义更清晰（"缓存 + invalidation"是每个 Python 工程师秒懂的模式，而 "Runnable proxy" 需要懂 LangChain 内部 hook 分层），**方案 C 是 agent-lab 的最优解**。
