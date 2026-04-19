# AG-UI 流式事件去重

> DeferredLLM + LangGraph `astream_events` 导致每个 streaming token 被发射两次的问题分析与修复。

## 问题现象

Chat 流式输出时，每个 token 重复一次：

```
最近最近有什么有什么让你让你感兴趣感兴趣
```

输出完成后显示正常文本（因为最终 `message.content` 是正确的）。

## 根因分析

### 事件链路

```
用户发消息
  → CopilotChat → AG-UI agent/run → CopilotRuntime (BFF) → Python Agent Server
  → LangGraph create_react_agent 调用 DeferredLLM
  → DeferredLLM._astream() 委托给 ChatOpenAI._astream()
  → ChatOpenAI 从 Ollama/OpenAI API 接收 streaming chunks
  → LangGraph astream_events 捕获事件
  → ag-ui-langgraph adapter 转换为 AG-UI TEXT_MESSAGE_CONTENT
  → SSE → BFF 透传 → CopilotKit 前端
```

### 重复发生在哪一层

`DeferredLLM` 是 `BaseChatModel` 的子类（延迟解析 LLM 配置的包装器）。当 LangGraph 用 `astream_events` 遍历执行图时，会捕获**所有 `BaseChatModel` 节点**的 `on_chat_model_stream` 事件。

一个 token 经过两个 `BaseChatModel`：

```
ChatOpenAI._astream() 产出 chunk
  → LangGraph 捕获 on_chat_model_stream (name="ChatOpenAI", run_id=A)

DeferredLLM._astream() yield 同一个 chunk
  → LangGraph 捕获 on_chat_model_stream (name="DeferredLLM", run_id=B)
```

`ag-ui-langgraph` adapter 把两个 `on_chat_model_stream` 都转成 `TEXT_MESSAGE_CONTENT` 事件，每个 token 被发射两次。

### 前端日志证据

```json
// 第一个事件（ChatOpenAI）
{"type":"TEXT_MESSAGE_CONTENT", "delta":"你好",
 "rawEvent":{"run_id":"...8a0b","name":"ChatOpenAI","ls_provider":"openai"}}

// 第二个事件（DeferredLLM）—— 相同 delta，不同 run_id
{"type":"TEXT_MESSAGE_CONTENT", "delta":"你好",
 "rawEvent":{"run_id":"...bac9","name":"DeferredLLM","ls_provider":"deferredllm"}}
```

### 为什么之前没暴露

CopilotKit 内置的 streamdown 渲染器有增量 diff 机制，重复的 delta 被它内部消化了。换成 react-markdown（全量重渲染 `message.content`）后，累加了两倍的 content，重复显现。

## 排查过程

### 尝试 1：前端去掉共享 threadId（失败）

猜测两个 `useAgent` 订阅同一 clone 导致双重处理。**没有日志验证就动手改，方向错误。**

### 尝试 2：前端加 AG-UI 事件日志（定位成功）

```tsx
agent.subscribe({
  onTextMessageContentEvent: ({ event }) =>
    console.log('[AG-UI] TEXT_CONTENT', JSON.stringify(event)),
});
```

日志明确显示每个 delta 有两个事件（ChatOpenAI + DeferredLLM）。**定位到问题在 Python 侧。**

### 尝试 3：DeferredLLM 不传 run_manager（失败）

修改 `DeferredLLM._astream()` 传 `run_manager=None` 给内层 ChatOpenAI，试图阻止内层发射回调。但 LangGraph 的 `astream_events` 在更高层捕获事件，不受 `run_manager` 控制。

### 尝试 4：agui_tracing.py 用 raw_event.run_id 过滤（失败）

AG-UI 事件的 `raw_event` 字段在 Python 侧是 `None`（前端的 `rawEvent` 是 JS adapter 加的）。**没有先验证字段可用性就写代码。**

### 尝试 5：agui_tracing.py 连续去重 + Python 日志验证（成功）

在 `_dispatch_event` 中：
1. 加 `log.info("content_event", ...)` 验证方法被调用
2. 用 `(message_id, delta)` 对检测连续重复
3. Python 日志确认去重生效（`content_dedup_dropped`）
4. 前端日志确认只剩 ChatOpenAI 事件

## 修复方案

### 修复位置

`agents/radar/src/radar/agui_tracing.py` — `TracingLangGraphAGUIAgent._dispatch_event()`

### 去重逻辑

```python
# 上一个 CONTENT 事件的 (message_id, delta)
self._last_content: tuple[str | None, str | None] = (None, None)

def _dispatch_event(self, event):
    event_type = getattr(event, "type", None)

    # ... START/END 配对去重 ...

    elif event_type == EventType.TEXT_MESSAGE_CONTENT:
        key = (getattr(event, "message_id", None), getattr(event, "delta", None))
        if key == self._last_content:
            # 连续重复 → 丢弃，重置以允许后续合法相同 delta 通过
            self._last_content = (None, None)
            return None
        self._last_content = key

    return super()._dispatch_event(event)
```

### 为什么用连续对检测而不是其他方案

| 方案 | 问题 |
|------|------|
| 用 `raw_event.run_id` 区分 | Python 侧 `raw_event` 是 `None` |
| 不传 `run_manager` 给内层 | LangGraph `astream_events` 不受控 |
| 按 `name` 过滤 DeferredLLM | AG-UI 事件上没有 `name` 字段 |
| **连续 `(message_id, delta)` 对** | **可用——事件总是成对连续到达** |

### 边界情况

LLM 输出相同 token 两次（如 "好好"，每个 "好" 是独立 chunk）：

```
ChatOpenAI: delta="好" → pass（last=None）
DeferredLLM: delta="好" → drop（match=True），重置 last=None
ChatOpenAI: delta="好" → pass（last=None）
DeferredLLM: delta="好" → drop（match=True）
```

每对独立去重，不影响合法重复。

## 完整去重层级

`observability/repair.py`（原 agui_tracing.py 拆出，ADR-010）有三层去重：

| 层 | 事件类型 | 策略 | 原因（Phase 5#2 v3 验证后） |
|----|---------|------|------|
| START 配对 | `TEXT_MESSAGE_START`, `TOOL_CALL_START` | 同 ID 重复 START 吞掉 | **DeferredLLM 组合效应**（原文描述"Ollama/本地模型 adapter 重复发射"已证伪）|
| END 孤立 | `TEXT_MESSAGE_END`, `TOOL_CALL_END` | 无对应 START 的 END 吞掉 | 上面吞掉 START 后 END 成孤立 |
| CONTENT 连续 | `TEXT_MESSAGE_CONTENT` | 连续相同 `(message_id, delta)` 丢弃第二个 | DeferredLLM 包装器导致双重 `on_chat_model_stream` |

**统一根因**：所有三层重复都源自 `DeferredLLM`（`BaseChatModel` 子类）让 LangGraph `astream_events` 对每 token 触发两次 `on_chat_model_stream`，ag-ui-langgraph adapter 对每次 stream 走一遍 `_handle_single_event` 状态机，两次之间 `OnChatModelEnd` 清 `has_current_stream` → 第二次判定为 START 再发一次。根治方案见 [`22` ADR-011](./22-OBSERVABILITY-ENTERPRISE.md#adr-011) + [`28-DEFERRED-LLM-RESEARCH.md`](./28-DEFERRED-LLM-RESEARCH.md)。

## Phase 5#2 对照实验（2026-04-19 白盒验证）

**目标**：验证 START 重复根因是否真是 DeferredLLM 组合效应（与 CONTENT 同源），还是独立的 ag-ui-langgraph 上游 bug。

**设计**：关补丁（`REPAIR_AGUI_DEDUP=0`），Ollama qwen3.5:9b + 2 个 tool 诱导 tool call + 5 rounds，对照两组：

- **A**：`create_react_agent(model=DeferredLLM)` — 当前生产态
- **B**：`create_react_agent(model=直接 ChatOpenAI)` — 绕过 DeferredLLM

**v2（失败 — 维度降维陷阱）**：用 `len(list) - len(set)` 单 id 维度统计，得出"B 组 TOOL_CALL_START 3/6 dup → 上游 bug"的错误结论，**差点据此给 ag-ui-langgraph 提 issue**。

**v3（白盒 + 完整 tuple）**：读 ag-ui-langgraph `agent.py:717-875` 源码，发现 `TOOL_CALL_START` 带 `(id, name, parent_message_id)` 三字段。capture 完整 tuple 重新统计：

| 组 | TOOL_CALL_START 总数 | **真 dup**（完整 tuple 重复） | ID 冲突（id 同 parent 不同） |
|---|---|---|---|
| A (DeferredLLM) | 18 | **8** | 1 |
| B (直接 ChatOpenAI) | 10 | **0** | 1 |

| 组 | TEXT_MESSAGE_START 总数 | 真 dup |
|---|---|---|
| A | 6 | 3 |
| B | 4 | **0** |

**结论**：
- **所有真 dup 都在 A 组**，纯 DeferredLLM 组合效应，不是上游 bug
- v2 的 B 组 "dup" 是 Ollama 偶发 `parent_message_id=None` 同 id chunk（r4 `call_vp17ns0g`），维度降维假阳性
- 不需给 ag-ui-langgraph 提 issue
- 根治方向是重构 DeferredLLM（见 [`28`](./28-DEFERRED-LLM-RESEARCH.md)）

**方法论教训**：

1. **黑盒降维统计是假阳性温床**：`set()` 去掉关键辨识字段导致错判
2. **白盒优先**：读 adapter 源码 20 min 比黑盒测 1h 更能定性
3. **小样本放大噪音**：3 rounds 的偶发行为被当系统性模式
4. **缺负控制组**：如果加 `LLM_MOCK` 组可更早发现 B 组 "dup" 是 Ollama 特异性
5. **"重复"必须定义到所有相关字段**，不是主 key

## 排查反思

1. **应该先加日志再改代码** — 前端日志一步定位到 Python 侧，后续本应直接加 Python 日志验证去重是否生效，跳过中间两次无效尝试
2. **验证字段可用性再写过滤逻辑** — `raw_event` 在 Python 侧为 `None`，应该先 `print(event.raw_event)` 确认
3. **DeferredLLM 作为 BaseChatModel 子类的副作用** — LangGraph `astream_events` 捕获所有 BaseChatModel 节点的事件，包装器模式天然导致重复。这是架构决策的隐含代价。**Phase 5#2 v3 进一步证明 START / CONTENT / ARGS 全都同源**，补丁层只治标，根治方案见 [`28`](./28-DEFERRED-LLM-RESEARCH.md)。
