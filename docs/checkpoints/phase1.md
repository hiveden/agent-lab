# Phase 1 验证记录 — 2026-04-17

## 目标

替换 `MemorySaver` 为 `AsyncSqliteSaver`，让 LangGraph 对话状态持久化到文件。最小改动，不动自研 `_persist_chat` 逻辑。

## 改动文件

- `agents/radar/pyproject.toml` — 加 `langgraph-checkpoint-sqlite>=2.0` 依赖
- `agents/radar/src/radar/agent.py` — `create_radar_agent` 增加 `checkpointer: BaseCheckpointSaver | None = None` 参数（默认 MemorySaver，向后兼容）
- `agents/radar/src/radar/main.py` — 用 FastAPI `lifespan` + `AsyncSqliteSaver.from_conn_string` 做 async 初始化，agent 实例化 + `add_langgraph_fastapi_endpoint` 注册移入 lifespan
- `agents/radar/.gitignore` — 加 `data/`、`*.db`、`*.db-shm`、`*.db-wal` 规则
- `agents/radar/tests/test_sqlite_checkpointer.py` — 新增 3 个 pytest 用例
- `agents/radar/tests/test_persist_chat.py` — 修 Phase 1 前已失败的遗留 assertion

## 新增测试

`agents/radar/tests/test_sqlite_checkpointer.py`：

- `test_checkpointer_accumulates_without_duplication` — 3 轮 invoke 后 messages 线性累积
- `test_checkpointer_survives_instance_rebuild` — 重建 agent 实例（模拟进程重启）后同 thread 历史仍在
- `test_different_threads_isolated` — 不同 thread_id 状态互相隔离

## 验证结果

### pytest

```
138 passed, 4 warnings in 40.97s
```

包含：3 个新 sqlite_checkpointer 用例 + 全量现有测试无回归。

### smoke（手动）

1. `uv run radar-serve` — lifespan 触发 `aiosqlite.connect`，启动成功
2. `curl /health` → `{"status":"ok"}`
3. `curl /agent/chat/health` → `{"status":"ok","agent":{"name":"radar"}}` — 确认路由在 lifespan 内注册成功
4. `agents/radar/data/checkpoints.db` 自动创建，4KB
5. `POST /agent/chat` 完整处理请求，SSE 返回 `RUN_FINISHED`，事件流中出现 `MESSAGES_SNAPSHOT`（Phase 3 关键事件）
6. 第一轮请求后 `sqlite3 checkpoints.db "SELECT thread_id, COUNT(*) FROM checkpoints GROUP BY thread_id"` → `smoke-thread-1 | 3`
7. 第二轮请求后同 thread → `smoke-thread-1 | 6`（累积正常）

## 重要观察

- 事件流中已包含 **`MESSAGES_SNAPSHOT`** 事件，ag-ui-langgraph 已经在从 checkpointer 读取状态并发射这个事件 → 说明 CopilotKit 恢复历史的能力已经在走正常路径，Phase 3 POC 有较高成功预期
- lifespan 中调 `add_langgraph_fastapi_endpoint` 注册路由正常工作（Starlette 允许 startup phase 注册路由）
- `create_radar_agent` 保持向后兼容（checkpointer 默认 MemorySaver），现有 pytest 不需要改动

## 遗留 / 下一步

- Phase 2 待实施 — 消息重复根治的核心 Phase
  - Python `_persist_chat` 不再传 messages 字段
  - BFF `persist/route.ts` 删除 insertMessage 循环
  - 前端 `SessionDetail.tsx` 删除 mount-time `setMessages` useEffect
  - 新增 pytest + Vitest + Playwright 测试

## 关联文档

- [docs/20-LANGGRAPH-PERSISTENCE.md](../20-LANGGRAPH-PERSISTENCE.md) §5 Phase 1 + §8.3 测试方案
- [docs/19-COPILOTKIT-EVENT-FLOW.md](../19-COPILOTKIT-EVENT-FLOW.md) CopilotKit 事件流架构
