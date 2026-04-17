# LangGraph 持久化方案 — 消息重复问题根治

## 1. 问题：消息重复 bug

### 1.1 现象

同一个 threadId 下进行多轮对话后，DB 中消息数量呈等差级数膨胀：

| 对话轮次 | 实际应存消息数 | 当前 DB 中消息数 |
|---------|--------------|----------------|
| 1 轮（2 条） | 2 | 2 |
| 2 轮（4 条） | 4 | 6 |
| 3 轮（6 条） | 6 | 12 |
| N 轮（2N 条） | 2N | N(N+1) |

如果有 tool 消息（evaluate 一次产生 4-6 条），膨胀更严重。

### 1.2 数据流链路

```
graph.aget_state(thread_id)          ← 返回全部历史消息（累积）
  → _langchain_messages_to_dicts()   ← 转为 dict，无 id 字段
  → PlatformClient.persist_chat()    ← POST 全量到 BFF
  → route.ts: for (msg of messages)  ← 遍历全量
    → insertMessage(genId(), ...)    ← 每条生成新 id，直接 INSERT
```

**关键断裂点**：
- LangGraph state 是**累积的**，每次 `aget_state` 返回该 thread 的**全部** messages
- Python 端 `_langchain_messages_to_dicts` 生成的 dict **没有消息 id**（只有 role / content / tool_calls / tool_call_id）
- BFF 端 `insertMessage` 每次 `genId()` 生成新 UUID，**无去重逻辑**
- 结果：每次 persist 都全量追加，同一条消息被重复 INSERT

### 1.3 关键代码位置

| 文件 | 行号 | 问题 |
|------|------|------|
| `agents/radar/src/radar/agui_tracing.py` | 227-255 | `_persist_chat` 每次从 graph state 取全量 messages |
| `agents/radar/src/radar/agui_tracing.py` | 36-72 | `_langchain_messages_to_dicts` 转换时丢失 message id |
| `apps/web/src/app/api/chat/persist/route.ts` | 69-79 | for 循环无条件 INSERT 每条消息 |
| `apps/web/src/lib/chat.ts` | 48-65 | `insertMessage` 每次 `genId()`，无 upsert |

### 1.4 下游影响

1. **历史消息加载重复** — `getSessionByThreadId` 返回的 session.messages 包含大量重复
2. **Trace 重复 spans** — `buildTraceFromPersistedMessages` 遍历消息构建 trace，重复消息 → 重复 spans
3. **活跃会话恢复注入重复** — `agent.setMessages(filtered)` 中包含重复消息
4. **数据膨胀** — 长期使用后 DB chat_messages 表失控增长

---

## 2. 根因：在重新发明轮子

### 2.1 LangGraph 已经有持久化方案

项目当前已经配置了 `MemorySaver` 作为 checkpointer（`agent.py:59`）。ag-ui-langgraph adapter 基于 checkpointer 管理所有消息累积和去重逻辑。

**我们又自己写了一套 `_persist_chat` 全量 POST 到 D1 的逻辑 — 这就是重复的根源。**

### 2.2 双重持久化冲突

```
┌─────────────────────────────────────────────────────┐
│  LangGraph checkpointer (MemorySaver)               │
│  按 super-step 自动保存 state snapshot              │
│  同 thread_id 下 messages 自动累积（不重复）        │  ← 官方方案
└─────────────────────────────────────────────────────┘
                      ⬇ 本应是 single source of truth
┌─────────────────────────────────────────────────────┐
│  自研 _persist_chat → D1 chat_messages              │
│  全量 POST 所有消息，无去重                         │  ← 重新发明的轮子
│  → 消息重复 bug                                     │
└─────────────────────────────────────────────────────┘
```

---

## 3. LangGraph 官方持久化机制

### 3.1 Checkpointer 工作原理

LangGraph 的 checkpointer 在每个 **super-step** 边界自动保存 graph state 的快照。每个 checkpoint 包含：

- `values` — 当前 channel state（包括 messages 列表）
- `next` — 下一步要执行的节点
- `config` — thread_id + checkpoint_id
- `metadata` — source、step 号、writes
- `parent_config` — 指向上一个 checkpoint

**thread_id 是 checkpointer 的主键**。同一 thread_id 下的多次 `invoke()` / `stream()` 调用，messages 通过 state schema 的 reducer（`Annotated[list, add]`）自动累积。

### 3.2 可用的 Checkpointer 实现

| Backend | 包名 | 适用场景 |
|---------|------|---------|
| **InMemorySaver** | `langgraph-checkpoint`（内置） | 开发/测试，进程重启丢失 |
| **AsyncSqliteSaver** | `langgraph-checkpoint-sqlite` | 本地持久化、单进程 |
| **AsyncPostgresSaver** | `langgraph-checkpoint-postgres` | 生产环境、多进程并发 |
| **RedisSaver** | `langgraph-redis` | 需要 TTL 过期的场景 |

所有实现遵循 `BaseCheckpointSaver` 接口：`put()` / `put_writes()` / `get_tuple()` / `list()`。

### 3.3 ag-ui-langgraph adapter 的消息管理

通过阅读 `ag_ui_langgraph/agent.py` 源码（1227 行）确认：

1. **`prepare_stream()`（L377）** — 每次 run 开始调用 `graph.aget_state(config)` 读取当前状态
2. **`langgraph_default_merge_state()`（L567）** — 将 AG-UI 传来的消息与 checkpoint 中已有的消息**按 message ID 去重合并**
3. **`get_state_and_messages_snapshots()`（L1203）** — run 结束后从 checkpointer 读取最终状态，发射 `MessagesSnapshotEvent`
4. **时间旅行（L491）** — `get_checkpoint_before_message()` 遍历 checkpoint 历史做 fork

**关键结论：ag-ui-langgraph 的整个消息管理机制就是基于 checkpointer 的。它不自己存储消息，checkpointer 就是它的"数据库"。**

### 3.4 CopilotKit 的官方持久化模式

根据 [CopilotKit 官方文档](https://docs.copilotkit.ai/langgraph/persistence/message-persistence)：

```
LangGraph checkpointer (PostgresSaver/SqliteSaver)
         ↓ (source of truth)
ag-ui-langgraph 读取 checkpoint，发射 MessagesSnapshotEvent
         ↓
CopilotKit 前端自动恢复消息列表
```

**不需要额外的持久化层**。前端传入相同 threadId，消息自动恢复。

---

## 4. 推荐方案：SqliteSaver + D1 存摘要

### 4.1 职责划分

| 层 | 职责 | 变更 |
|----|------|------|
| **LangGraph checkpointer (SqliteSaver)** | 消息历史的 source of truth（对话内容 + tool calls + state） | MemorySaver → AsyncSqliteSaver |
| **D1 chat_sessions** | Session 列表索引 + 元数据（config_prompt、result_summary） | 保留 |
| **D1 chat_messages** | 不再存消息 | 废弃或简化 |
| **Python `_persist_chat`** | 只 POST session 元数据，不 POST messages | 大幅简化 |
| **前端 `agent.setMessages()` hack** | 删除，CopilotKit 自动通过 MessagesSnapshotEvent 恢复 | 删除 |

### 4.2 新数据流

```
Agent run 完成
  ↓
LangGraph checkpointer 自动保存 state（含全部 messages，去重累积）
  ↓
_persist_chat 只 POST { agent_id, thread_id, config_prompt, result_summary } 到 BFF
  ↓
BFF 只更新 D1 chat_sessions 表（session 索引 + 元数据）

────────────────────────────────────────

用户切换到历史 session
  ↓
CopilotKit 传入 threadId
  ↓
ag-ui-langgraph 从 SqliteSaver 读取该 thread 的 checkpoint
  ↓
发射 MessagesSnapshotEvent，前端自动渲染
```

### 4.3 优势

1. **根治消息重复** — 消息由 checkpointer 统一管理，按 message id 去重合并
2. **进程重启不丢消息** — SqliteSaver 持久化到文件
3. **删除大量自研代码** — `_persist_chat` 的 messages 部分、前端 setMessages hack、D1 chat_messages 表可简化
4. **支持时间旅行** — ag-ui-langgraph 的 regenerate 功能自动可用
5. **对齐官方推荐** — 跟随 LangGraph + CopilotKit 的生态演进

---

## 5. 实施步骤

> **当前进度（2026-04-17）**：
> - ✅ Phase 1 已实施（commit 108ece6）
> - ✅ Phase 2 已实施（commit 22455ab）
> - ✅ CopilotKit 升级 1.56.2（commit 9b2069b）
> - ✅ 侧栏回归 bug fix（commit a177393）
> - ✅ Phase 3 A1 已实施（commit a2bbc6b / aa0878c）— 历史会话从 checkpointer 恢复 trace + 消息
> - ✅ Phase 4 部分完成 — 死代码 `_langchain_messages_to_dicts` + `message_count` 字段 + `useAgentSession.messages` 字段已清理（commit a2bbc6b / aa0878c）
>
> 验证记录：`docs/checkpoints/phase1.md` / `phase2.md` / `phase3-a1.md`。剩余清理见 `docs/21-TECH-DEBT.md`。

### Phase 1：替换 checkpointer（最小改动）

**改动 1 — `agent.py` 接受 checkpointer 注入**：

```python
# agents/radar/src/radar/agent.py
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import MemorySaver

def create_radar_agent(
    *,
    system_prompt: str = DEFAULT_SYSTEM_PROMPT,
    checkpointer: BaseCheckpointSaver | None = None,
) -> CompiledStateGraph:
    """生产环境注入 AsyncSqliteSaver；测试/CLI fallback 到 MemorySaver。"""
    llm = DeferredLLM(task="chat")
    tools = get_all_tools()
    return create_react_agent(
        model=llm,
        tools=tools,
        prompt=system_prompt,
        name="radar_agent",
        state_schema=AgentState,
        checkpointer=checkpointer if checkpointer is not None else MemorySaver(),
    )
```

**改动 2 — `main.py` 在 FastAPI lifespan 中通过 `AsyncSqliteSaver.from_conn_string` 创建 saver 并注入 agent**：

```python
# agents/radar/src/radar/main.py
from contextlib import asynccontextmanager
from pathlib import Path
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

# agents/radar/data/checkpoints.db
_CHECKPOINT_DB = Path(__file__).resolve().parent.parent.parent / "data" / "checkpoints.db"

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    _CHECKPOINT_DB.parent.mkdir(parents=True, exist_ok=True)
    async with AsyncSqliteSaver.from_conn_string(str(_CHECKPOINT_DB)) as saver:
        graph = create_radar_agent(checkpointer=saver)
        ag_ui_agent = TracingLangGraphAGUIAgent(
            name="radar",
            description="Radar Agent — intelligent content discovery assistant",
            graph=graph,
        )
        add_langgraph_fastapi_endpoint(app, ag_ui_agent, path="/agent/chat")
        yield

app = FastAPI(title="Radar Agent", version="0.1.0", lifespan=lifespan)
```

**实现要点**：
- 使用 `AsyncSqliteSaver.from_conn_string(path)` context manager 统一管理底层连接生命周期（自动 `setup()` + `close()`），比手动建连更干净
- Checkpointer 通过依赖注入传入 `create_radar_agent`，测试/CLI 场景可 fallback 到 `MemorySaver`

**验证**：
- 重启 FastAPI 进程，验证之前的对话能从 SqliteSaver 恢复
- 验证 `graph.aget_state(thread_id)` 返回正确的历史 messages

### Phase 2：移除自研持久化

**Python `_persist_chat` — 只 POST session 元数据**：

```python
# agents/radar/src/radar/agui_tracing.py
async def _persist_chat(self, thread_id: str) -> None:
    """Persist session-level metadata to D1 (config_prompt + result_summary)."""
    try:
        from agent_lab_shared.db import PlatformClient
        config = {"configurable": {"thread_id": thread_id}}
        state = await self.graph.aget_state(config)
        messages = state.values.get("messages", [])
        if not messages:
            log.info("persist_chat_skip", thread_id=thread_id, reason="no messages")
            return

        config_prompt = _extract_config_prompt(messages)
        result_summary = _extract_result_summary(messages)

        client = PlatformClient()
        # 注意：client.persist_chat 签名已不含 messages 参数
        await asyncio.to_thread(
            client.persist_chat,
            thread_id=thread_id,
            agent_id=self.name,
            config_prompt=config_prompt,
            result_summary=result_summary,
        )
    except Exception:
        log.exception("persist_chat_failed", thread_id=thread_id)
```

**BFF `/api/chat/persist` — 只更新 chat_sessions，不再插入 chat_messages**：

```typescript
// apps/web/src/app/api/chat/persist/route.ts（核心逻辑）
const { agent_id, thread_id, config_prompt, result_summary } = parsed.data;

const sessionId = await ensureSession(env.DB, {
  sessionId: thread_id,
  agentId: agent_id,
});

if (config_prompt !== undefined || result_summary !== undefined) {
  const metadata: {
    config_prompt?: string;
    result_summary?: { evaluated: number; promoted: number; rejected: number };
  } = {};
  if (config_prompt !== undefined) metadata.config_prompt = config_prompt;
  if (result_summary !== undefined) metadata.result_summary = result_summary;
  await updateSessionMetadata(env.DB, sessionId, metadata);
}

return NextResponse.json({ ok: true, session_id: sessionId });
```

**关键变更**：
- `persistBodySchema` 已移除 `messages` 字段
- 原先的 `for (const msg of messages) await insertMessage(...)` 循环已删除
- `chat_messages` 表不再有新数据写入（保留旧数据做兼容）

**前端 `SessionDetail.tsx` — 删除 mount-time `setMessages` hack**：CopilotKit 的 `connectAgent` + ag-ui-langgraph 的 `MESSAGES_SNAPSHOT` 事件会从 checkpointer 自动恢复，无需再手动注入。

### Phase 3 A1：历史会话消息恢复（已实施 — commit a2bbc6b / aa0878c）

**决策**：采用方案 A 的精简版——**保留双模式渲染**（active 用 `<CopilotChat>`、history 用只读消息列表），但统一数据源到 `agent.messages`，并对历史分支手动触发 `connectAgent` 让 checkpointer 消息流入 `agent.messages`。

**实施要点**：

1. **数据源统一**：`SessionDetail` 内 trace、resultBatches、消息列表全部读自 `agent.messages`（不再读 `session.messages`，后者已不存储消息内容）
2. **历史只读路径手动 `connectAgent`**：`<CopilotChat>` mount 时会自动调用 `copilotkit.connectAgent`，但只读分支没有它 —— 手动补上让 ag-ui-langgraph 从 checkpointer 发射 `MESSAGES_SNAPSHOT`：

```tsx
// apps/web/src/app/agents/radar/components/production/SessionDetail.tsx
const { copilotkit } = useCopilotKit();

useEffect(() => {
  if (isActiveSession) return; // active: <CopilotChat /> handles it
  if (!agent) return;
  let detached = false;
  void copilotkit.connectAgent({ agent }).catch((err) => {
    if (detached) return;
    console.error('SessionDetail: connectAgent (history) failed', err);
  });
  return () => { detached = true; };
}, [isActiveSession, agent, copilotkit]);
```

3. **保留双模式的理由**：active 会话需要 `<CopilotChat>` 的完整交互能力（输入框 + 流式渲染 + 中断按钮）；历史会话展示是只读，直接铺消息列表更清爽，避免误触发新 run

**端到端链路**（历史会话切换）：

```
侧栏点击历史 session
  → AgentView 更新 threadId prop
  → SessionDetail mount（isActiveSession === false）
  → useEffect 调用 copilotkit.connectAgent({ agent })
  → ag-ui-langgraph 从 AsyncSqliteSaver 读该 thread 的 checkpoint
  → 发射 MESSAGES_SNAPSHOT 事件
  → agent.messages 填充完整历史（含 tool calls）
  → 只读消息列表 + trace drawer 正常渲染
```

### Phase 4：清理（可选）

- ⏸️ `_langchain_messages_to_dicts` 函数（`agui_tracing.py:36-72`）和 `TestLangchainMessagesToDicts` 测试类 — Phase 2 后已成死代码
- ⏸️ `SessionSummary.message_count` 字段 — 前端 UI 不使用但 `listAgentSessions` 仍查询
- ⏸️ `useAgentSession.messages` 字段 — 永远返回空数组，字段存在误导
- ⏸️ `chat_messages` 表 — 保留做历史数据兼容，新数据不写入
- ⏸️ 生产环境 `showDevConsole` 条件化

详见 [`21-TECH-DEBT.md`](./21-TECH-DEBT.md)。

---

## 6. 风险与注意事项

### 6.1 AsyncSqliteSaver 初始化 — ✅ 已落地

采用 `AsyncSqliteSaver.from_conn_string(path)` 的 async context manager 模式，在 FastAPI lifespan 中构建，生命周期自动管理（内部处理底层 `aiosqlite` 连接 + `setup()` + `close()`）：

```python
# agents/radar/src/radar/main.py
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    _CHECKPOINT_DB.parent.mkdir(parents=True, exist_ok=True)
    async with AsyncSqliteSaver.from_conn_string(str(_CHECKPOINT_DB)) as saver:
        graph = create_radar_agent(checkpointer=saver)
        ag_ui_agent = TracingLangGraphAGUIAgent(name="radar", ..., graph=graph)
        add_langgraph_fastapi_endpoint(app, ag_ui_agent, path="/agent/chat")
        yield
```

相比最初规划的手动建连 + `AsyncSqliteSaver(conn=...)` + 显式 `setup()` 方式，`from_conn_string` 更干净且已在 Phase 1 实测通过。

### 6.2 CopilotKit AG-UI thread 支持 — ✅ 1.56.2 已解锁

升级到 CopilotKit `1.56.2` 后，相关 thread 支持已合入主线（[PR #3872](https://github.com/CopilotKit/CopilotKit/pull/3872) 已合并），Phase 3 A1 的端到端恢复链路实测可用。

历史遗留 issue（仅保留备查）：
- [CopilotKit#2328](https://github.com/CopilotKit/CopilotKit/pull/2328) — 早期 WIP
- [CopilotKit#2402](https://github.com/CopilotKit/CopilotKit/issues/2402) — 旧版持久化失效
- [CopilotKit#2336](https://github.com/CopilotKit/CopilotKit/issues/2336) — 旧版新对话空 state

### 6.3 部署

- **实际 SQLite 文件路径**：`agents/radar/data/checkpoints.db`（仓库 `.gitignore`，首次启动自动创建）
- Docker/生产部署时需挂载 `agents/radar/data/` 为持久卷
- 长期运行后 SQLite 文件会增长，后续需要定期清理老 thread 的 checkpoint（保留最新即可）

### 6.4 config_prompt 提取仍依赖 CopilotKit 编码

`_extract_config_prompt` 从 system message 中匹配关键词提取配置。这个耦合在 Phase 2 后依然存在，但封装在一个函数中，CopilotKit 格式变化时只需改这一处。

---

## 7. 对比：方案 A（先删后插）vs 方案 B（checkpointer）

> ✅ **方案 B（checkpointer）已采纳并实施完成**。以下对比保留作为决策叙述参考。

| 维度 | 方案 A：先删后插 | 方案 B：SqliteSaver |
|------|-----------------|-------------------|
| 修复消息重复 | ✅ | ✅ |
| 改动规模 | 小（BFF 加一行 DELETE） | 中（替换 checkpointer + 删除 persist 逻辑） |
| 架构合理性 | 维持双重存储 | 对齐官方推荐 |
| 进程重启恢复 | ❌（仍用 MemorySaver） | ✅ |
| 时间旅行 | ❌ | ✅ |
| 长期维护 | 需持续维护自研持久化 | 跟随生态 |
| 对齐 doc 19 目标架构 | ❌ | ✅ |

**推荐方案 B**。方案 A 是临时补丁，方案 B 是根治。

---

## 8. 本地测试方案

本方案为**本地开发验证**，不涉及 CI / 上线流程。对齐项目已有三套测试架构：**pytest**（Python 端）/ **Vitest**（Node 端）/ **Playwright**（E2E）。不自造 bash 验证脚本。

### 8.1 核心验证点

| # | 目标 | 测试层 | 判定标准 |
|---|------|--------|---------|
| **V1** | 消息重复根治 | pytest | `len(aget_state(...).values["messages"]) == 2N` 线性累积 |
| **V2** | 进程重启恢复 | pytest + Playwright | 重建 agent 实例/重启 FastAPI 后同 thread 历史仍在 |
| **V3** | 会话切换恢复 | Playwright | 侧栏点历史 thread 后消息 + trace 完整显示 |

V1 通过 = 核心 bug 根治。V2/V3 通过 = 架构演进达成。

### 8.2 测试工具分工

| 验证对象 | 测试层 | 命令 |
|---------|--------|------|
| LangGraph checkpointer 累积去重 | **pytest** | `uv run --package agent-lab-radar pytest agents/radar/tests/ -v` |
| `_persist_chat` 只传元数据（mock PlatformClient）| **pytest** | 同上 |
| BFF `/api/chat/persist` 接受新 payload | **Vitest** | `cd apps/web && pnpm test` |
| D1 `chat_sessions` 元数据写入、`chat_messages` 不被写 | **Vitest**（miniflare 本地 D1）| 同上 |
| 端到端消息不膨胀 | **Playwright** | `E2E_FILTER="no-message-duplication" bash scripts/run-e2e.sh` |
| 切换历史会话恢复 | **Playwright** | 同上，filter 对应 spec |

**原则**：能用 pytest/Vitest 断言的就不要手动查 DB；能用 Playwright 录屏回放的就不要靠截图。

### 8.3 Phase 1 验证：SqliteSaver 能跑

**改动**：`MemorySaver()` → `AsyncSqliteSaver(...)`，其他不动。

**pytest 用例**（`agents/radar/tests/test_sqlite_checkpointer.py` 新增）：

```python
import pytest
from langchain_core.messages import HumanMessage

@pytest.mark.asyncio
async def test_checkpointer_accumulates_without_duplication():
    """同 thread 多轮后 messages 线性累积，不重复"""
    agent = await create_radar_agent()
    config = {"configurable": {"thread_id": "test-accumulation"}}

    await agent.graph.ainvoke({"messages": [HumanMessage("轮1")]}, config)
    n1 = len((await agent.graph.aget_state(config)).values["messages"])

    await agent.graph.ainvoke({"messages": [HumanMessage("轮2")]}, config)
    n2 = len((await agent.graph.aget_state(config)).values["messages"])

    assert n2 == n1 + 2, f"膨胀了！n1={n1}, n2={n2}"

@pytest.mark.asyncio
async def test_checkpointer_survives_instance_rebuild():
    """重建 agent 实例（模拟进程重启）后，同 thread 仍能读到历史"""
    config = {"configurable": {"thread_id": "test-restart"}}

    agent1 = await create_radar_agent()
    await agent1.graph.ainvoke({"messages": [HumanMessage("第一次")]}, config)
    del agent1  # 释放连接

    agent2 = await create_radar_agent()  # 新实例、新连接、同 DB 文件
    state = await agent2.graph.aget_state(config)
    assert len(state.values["messages"]) >= 2
```

**手动 smoke**（确认文件真的写入）：
1. `pnpm dev:web` + `uv run radar-serve`
2. 浏览器发 3 轮对话
3. `ls -lh agents/radar/data/checkpoints.db` — 文件应存在且有数据
4. 刷新浏览器 — 历史应可见

**通过标准**：pytest 绿 + 手动 smoke 通过。

### 8.4 Phase 2 验证：消息重复根治（核心 Phase）

**改动**：
- Python `_persist_chat` 不再传 messages 字段
- BFF `persist/route.ts` 删除 `insertMessage` 循环
- 前端 `SessionDetail.tsx` 删除 mount-time `setMessages` useEffect

**pytest 用例**（`agents/radar/tests/test_persist_metadata_only.py` 新增）：

```python
from unittest.mock import AsyncMock, patch

@pytest.mark.asyncio
async def test_persist_chat_omits_messages_field():
    """_persist_chat 调用 PlatformClient 时不应传 messages 参数"""
    with patch("agent_lab_shared.db.PlatformClient") as mock_cls:
        mock_cls.return_value.persist_chat = AsyncMock()

        agent = build_tracing_agent()  # 预先塞几条消息到 graph state
        await agent._persist_chat("thread-1")

        kwargs = mock_cls.return_value.persist_chat.call_args.kwargs
        assert "messages" not in kwargs, "messages 字段应已移除"
        # 元数据仍应发送
        assert kwargs.get("thread_id") == "thread-1"
        assert "config_prompt" in kwargs or "result_summary" in kwargs
```

**Vitest 用例**（`apps/web/src/app/api/chat/persist/__tests__/route.test.ts` 新增）：

```typescript
import { describe, it, expect } from 'vitest';
import { POST } from '../route';

describe('POST /api/chat/persist', () => {
  it('accepts body without messages, writes only metadata to D1', async () => {
    const req = new Request('http://localhost/api/chat/persist', {
      method: 'POST',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
      body: JSON.stringify({
        agent_id: 'radar',
        thread_id: 'vitest-thread',
        config_prompt: 'test config',
        result_summary: { evaluated: 10, promoted: 2, rejected: 8 },
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const session = await db.query.chatSessions.findFirst({
      where: eq(chatSessions.id, 'vitest-thread'),
    });
    expect(session?.config_prompt).toBe('test config');
    expect(session?.result_summary).toEqual({ evaluated: 10, promoted: 2, rejected: 8 });

    // 核心断言：chat_messages 表无插入
    const msgs = await db.query.chatMessages.findMany({
      where: eq(chatMessages.session_id, 'vitest-thread'),
    });
    expect(msgs).toHaveLength(0);
  });
});
```

**Playwright E2E**（`apps/web/e2e/no-message-duplication.spec.ts` 新增）：

```typescript
import { test, expect } from '@playwright/test';

test('5 轮对话后消息数精确无膨胀', async ({ page }) => {
  await page.goto('http://127.0.0.1:8788/agents/radar');
  await page.click('text=+ 新建');

  for (let i = 0; i < 5; i++) {
    await page.fill('[contenteditable="true"]', `测试消息 ${i}`);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.assistant-bubble:not(.streaming)', { timeout: 60_000 });
  }

  const threadId = await page.evaluate(() =>
    localStorage.getItem('agent-lab.radar.threadId')
  );

  // 切走再切回来，触发 checkpointer 恢复
  await page.click('text=+ 新建');
  await page.evaluate((id) =>
    localStorage.setItem('agent-lab.radar.threadId', id!), threadId);
  await page.reload();

  const userCount = await page.locator('.user-bubble').count();
  const assistantCount = await page.locator('.assistant-bubble').count();
  expect(userCount).toBe(5);
  expect(assistantCount).toBe(5);
});
```

**运行**：

```bash
# Python 端
uv run --package agent-lab-radar pytest agents/radar/tests/test_persist_metadata_only.py -v

# Node 端
cd apps/web && pnpm test -- persist

# E2E（录屏产出在 apps/web/e2e/test-results/）
E2E_FILTER="no-message-duplication" bash scripts/run-e2e.sh
```

**通过标准**：
- [ ] pytest 绿（`_persist_chat` 不传 messages）
- [ ] Vitest 绿（BFF 不写 chat_messages，仅写 chat_sessions 元数据）
- [ ] Playwright E2E 绿（精确 5 条 user + 5 条 assistant，录屏为证）

### 8.5 Phase 3 验证：历史会话用 CopilotKit 恢复

**风险**：CopilotKit AG-UI thread 支持 WIP（#2328），**先 POC 验证再决定做不做**。POC 不写自动化测试（代码不会留）。

**POC 步骤**：

1. 临时把 `SessionDetail.tsx` 中 `isActiveSession` 强制为 `true`，让历史会话也走 `CopilotChat` 分支
2. 浏览器切换到一个有 tool call 的历史会话
3. DevTools Network 过滤 `chat`，观察 SSE 流中是否出现 `MESSAGES_SNAPSHOT` 事件
4. Console 验证：
   ```javascript
   const insp = document.querySelector('cpk-web-inspector');
   console.log('agent messages:', insp?.__agents?.radar?.messages);
   ```

**POC 判定**：

| 信号 | 继续 Phase 3 | 搁置 Phase 3 |
|------|-------------|-------------|
| SSE 出现 MESSAGES_SNAPSHOT | ✅ | — |
| agent.messages 含历史 | ✅ | ❌ → 搁置 |
| tool_calls 字段完整 | ✅ | ❌ → 搁置 |
| Trace 重建正确 | ✅ | ❌ → 搁置 |

**POC 通过后补 Playwright E2E**（`apps/web/e2e/history-session-recovery.spec.ts`）：

```typescript
test('切换到历史会话后消息+trace 完整显示', async ({ page }) => {
  // 预置：先走正常流程创建一个有 tool call 的 thread，拿到 threadId
  // 侧栏切到该 thread
  // 断言：user+assistant 消息数符合预期，trace drawer 有 evaluate span
});
```

**搁置预案**：保留当前双模式渲染。Phase 2 已独立根治消息重复，核心目标不受影响。

### 8.6 不回归 smoke（每个 Phase 完成后都跑一遍）

**自动化**：

```bash
cd apps/web && pnpm test                                             # Vitest 全量
uv run --package agent-lab-radar pytest agents/radar/tests/ -v       # pytest 全量
bash scripts/run-e2e.sh                                              # Playwright 全量
```

**手动 smoke**（自动化覆盖不到的 UI 交互）：

- [ ] 新消息流式显示正常，无闪烁异常
- [ ] "执行评判"预设按钮 → Results Pane 正确展示
- [ ] ConfigCards 编辑保存 → 新会话 agent 能看到偏好
- [ ] Trace Drawer 打开，tool span input/output 正确
- [ ] 侧栏会话 preview 正确显示
- [ ] 无 console 红色错误
- [ ] FastAPI 日志无 exception
- [ ] Inspector Dev Console 有事件流

### 8.7 执行顺序

```
Phase 1 改完
  → pytest (§8.3) + 手动 smoke
  → §8.6 自动化回归
  → 通过 ✅ 进 Phase 2

Phase 2 改完（核心）
  → pytest + Vitest + Playwright (§8.4)
  → §8.6 自动化回归
  → 通过 ✅ 决定是否进 Phase 3

Phase 3（可选）
  → §8.5 POC 先验证
  → POC 通过才动手实施
  → 补 Playwright E2E + §8.6 回归
```

### 8.8 每 Phase 完成后留记录

在 `docs/checkpoints/` 下留简短记录（对齐"可交付流程"原则）：

```markdown
# Phase 2 验证记录 - 2026-04-17

## 改动文件
- agents/radar/src/radar/agui_tracing.py（_persist_chat 不再传 messages）
- apps/web/src/app/api/chat/persist/route.ts（删除 insertMessage 循环）
- apps/web/src/app/agents/radar/components/production/SessionDetail.tsx（删除 setMessages useEffect）

## 新增测试
- agents/radar/tests/test_persist_metadata_only.py
- apps/web/src/app/api/chat/persist/__tests__/route.test.ts
- apps/web/e2e/no-message-duplication.spec.ts

## 验证结果
- pytest: PASS ✅
- Vitest: PASS ✅
- Playwright E2E: PASS ✅（录屏：apps/web/e2e/test-results/no-message-duplication-*.webm）
- 手动 smoke: 全部通过 ✅

## 遗留
- Phase 3 POC 待做（是否真正移除双模式渲染取决于 POC 结果）
```

## 9. 参考资料

- [LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)
- [langgraph-checkpoint-sqlite](https://pypi.org/project/langgraph-checkpoint-sqlite/)
- [langgraph-checkpoint-postgres](https://pypi.org/project/langgraph-checkpoint-postgres/)
- [CopilotKit Message Persistence](https://docs.copilotkit.ai/langgraph/persistence/message-persistence)
- [CopilotKit Loading Message History](https://docs.copilotkit.ai/langgraph/persistence/loading-message-history)
- [CopilotKit PR #2328: Thread support for AG-UI agents](https://github.com/CopilotKit/CopilotKit/pull/2328)
