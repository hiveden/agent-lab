# 24 - 可观测性排查手册（Playbook）

> **创建**：2026-04-18
> **受众**：碰到 agent-lab bug / 性能问题 / 错误时，知道打开哪个工具、怎么 grep。
> **配套**：架构决策见 [`22-OBSERVABILITY-ENTERPRISE.md`](./22-OBSERVABILITY-ENTERPRISE.md)；启动/端口见 [`docker/README.md`](../docker/README.md)。

---

## 关键概念：一个 trace_id 贯穿全栈

**`trace_id` 是 OTel 标准 32-hex**（如 `371047b65cc5769f1965ea47dc52791f`），由浏览器 OTel SDK 生成，通过 W3C `traceparent` header 自动传到 BFF → Python。所有层 log 都带它。

**怎么拿到它？**
- 浏览器 chat header 的 chip（前 8 位短码）→ 点 chip 复制完整
- 或者 Python log: `grep trace_id=... agents/radar/*.log`
- 或者 collector debug stdout

---

## 决策树：遇到问题先看哪个工具

```
问题类型
├── chat 没响应 / 卡住 / 慢        → 看 Langfuse trace tree
│   └── 哪步慢一目了然 (LangGraph node + LLM call latency)
│
├── chat 响应错误但没报错            → 看 Python structlog (stderr)
│   └── 按 trace_id grep 有没有 warning / error
│
├── UI 崩 / 浏览器报错               → GlitchTip Issues + 浏览器 console
│   └── 注意过滤掉浏览器扩展噪音 (ImmersiveTranslate 等)
│
├── BFF 500 / 404                    → BFF terminal log + GlitchTip
│   └── Sentry @sentry/nextjs 自动 capture unhandled
│
├── Python unhandled exception       → GlitchTip (sentry-sdk) + Python structlog
│
├── 跨层时序 / 哪一跳慢              → SigNoz Services → Traces
│   └── 唯一能看到 browser + BFF + Python 一棵树的地方
│
├── LLM 质量 / token cost / prompt   → Langfuse Traces
│
├── 上游 (ag-ui-langgraph) 事件重复  → 设 REPAIR_AGUI_DEDUP=0 → OTel Collector debug exporter
│
└── 配置 / 环境变量问题              → `grep -E "(langfuse|sentry|otel)" .env*`
```

---

## 场景 1：发一条 chat 看完整链路

**目的**：理解一次 chat 走了哪些层，哪里慢。

**步骤**：

1. 起全栈：`bash docker/start-all.sh`
2. 浏览器开 http://127.0.0.1:8788 发一条消息
3. 点 chat header 的 chip 复制 trace_id（如 `abc123...`）
4. 同一 trace_id 三处查：

| 位置 | 看什么 |
|---|---|
| **Langfuse** `http://127.0.0.1:3010/project/<id>/traces/<trace_id>` | LangGraph 全树、每个 LLM call 的 prompt/completion/token/cost/latency |
| **SigNoz** `http://127.0.0.1:3301` → Traces → 过滤 trace_id | 浏览器 fetch + BFF + Python 的 span timing |
| **Python log** `grep <trace_id>` 当前 terminal 的 `radar-serve` 输出 | `trace_context_injected` / `persist_chat_ok` / LangGraph deserialize warning 等 |

---

## 场景 2：`REPAIR_AGUI_DEDUP=0` 对照实验 — 看上游原始事件流

**目的**：agui_tracing 默认开启补丁层吞重复事件。要看上游真原始发了几条，关掉补丁。

**步骤**：

```bash
# 1. 改 agents/radar/.env 加一行
REPAIR_AGUI_DEDUP=0

# 2. 重启 Python
cd agents/radar && uv run radar-serve

# 3. 浏览器发一条 chat 触发 tool call + 流式输出

# 4. 三处看:
#    a) Python log 中应该没有 "duplicate_start_suppressed" / "orphaned_end_suppressed" (补丁关了)
#       而且可能有事件重复的副作用 (前端崩 / INCOMPLETE_STREAM 错误)
#    b) OTel Collector debug stdout: 数 TOOL_CALL_START / TEXT_MESSAGE_START 有几条
docker compose -f docker/observability/docker-compose.yml logs --tail=500 | \
  grep -E "(TOOL_CALL_START|TEXT_MESSAGE_START)" | wc -l
#    c) 前端 console: 看 CopilotKit error 是否复现 (INCOMPLETE_STREAM 等)
```

**判读**：

| 观察 | 结论 |
|---|---|
| 没有重复事件 | 可能 Phase 3 升级 contrib / OpenLLMetry 修了上游, 可以考虑删 repair.py |
| 仍有重复 TOOL_CALL_START | ag-ui-langgraph 独立 bug, 可以提 upstream issue |
| 仅 TEXT_MESSAGE_CONTENT 重复 | DeferredLLM 组合效应, 见场景 3 对照 |

**用完恢复**：删 `REPAIR_AGUI_DEDUP=0` 或改 `=1`，重启。

---

## 场景 3：DeferredLLM 对照实验 — 验证 CONTENT 重复根因

**假设**：CONTENT 重复是项目 `DeferredLLM` 包装器 + LangGraph `astream_events` 捕获所有 `BaseChatModel` 节点的组合效应。

**步骤**：

1. 临时改 `agents/radar/src/radar/agent.py`（或 LLM factory）用 `ChatOpenAI` 直接替代 `DeferredLLM` 包装
2. 重启 Python + 设 `REPAIR_AGUI_DEDUP=0`
3. 发一条 chat 流式响应
4. 看 OTel Collector debug：`TEXT_MESSAGE_CONTENT` 是否还每个 delta 出现两次

**判读**：

- **不再重复** → 根因确认是 DeferredLLM + astream_events 组合，**不是 ag-ui-langgraph bug**
- **仍重复** → 有其他源头（上游 bug / 另一个 BaseChatModel 嵌套）

**恢复**：git checkout 原 agent.py。

---

## 场景 4：Cloud ↔ 自托管 Langfuse 切换

**切 Cloud**（关闭自托管栈，用 Langfuse Cloud）：

```bash
# 1. 停自托管 (可选, 不停也能切)
cd docker/langfuse && docker compose down

# 2. 改 agents/radar/.env
LANGFUSE_HOST=https://us.cloud.langfuse.com
LANGFUSE_PUBLIC_KEY=pk-lf-<Cloud 的>
LANGFUSE_SECRET_KEY=sk-lf-<Cloud 的>

# 3. 改 apps/web/.env.local
NEXT_PUBLIC_LANGFUSE_HOST=https://us.cloud.langfuse.com
NEXT_PUBLIC_LANGFUSE_PROJECT_ID=<Cloud 的 project id>

# 4. 重启 Python + web + OTel Collector
#    (collector 会自动从 .env 读新 endpoint)
bash docker/observability/start.sh
# 重启 web + agent
```

**切回自托管**：反向操作。数据不互通（Cloud 有 Cloud 的 trace，自托管有自己的），切换时旧 trace 不跟过来。

**混合策略**（高级）：collector 配 3 个 exporter 同时推 Cloud + 自托管 SigNoz + 自托管 Langfuse。改 `docker/observability/otel-collector-config.yml` 加第三条 pipeline。

---

## 场景 5：三端 Sentry 错误 → GlitchTip 失联

**症状**：GlitchTip Issues 列表空的，但应用有 error。

**排查清单**：

1. **DSN 配对吗？**
   ```bash
   echo $SENTRY_DSN
   # 应该形如: http://xxx@localhost:8002/1
   cat apps/web/.env.local | grep SENTRY
   # NEXT_PUBLIC_SENTRY_DSN + SENTRY_DSN 都要配
   ```

2. **GlitchTip 起来没？**
   ```bash
   curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8002
   # 200 = OK
   ```

3. **Python 端**：`sentry_sdk.init` 有跑吗？
   ```bash
   grep "sentry_sdk.init" agents/radar/src/radar/main.py
   # 看到 if settings.sentry_dsn: 分支
   ```

4. **手动发测试事件验证管道**：
   ```bash
   cd agents/radar && uv run python -c "
   from agent_lab_shared.config import settings
   import sentry_sdk
   sentry_sdk.init(dsn=settings.sentry_dsn)
   sentry_sdk.capture_message('test from playbook')
   sentry_sdk.flush()
   "
   # 去 GlitchTip Issues 刷新应该看到 'test from playbook'
   ```

5. **浏览器**：F12 console 跑 `throw new Error('test')`，5 秒后看 GlitchTip。

6. **BFF**：curl 一个 throw 的 API route（见 Phase 4 #3b commit 的 `sentry-test`）。

---

## 场景 6：SigNoz 看不到 service.name=radar

**症状**：SigNoz UI Services 页空，或只有 `agent-lab-web` 没有 `radar`。

**排查**：

1. **Python OTel 导出配置**：
   ```bash
   grep OTEL_EXPORTER_OTLP_ENDPOINT agents/radar/.env
   # 应该 http://localhost:4318
   ```

2. **Collector 到 SigNoz 的 exporter 在工作？**
   ```bash
   docker compose -f docker/observability/docker-compose.yml logs --tail=100 | \
     grep -iE "(signoz|Exporting failed)"
   # 应该无 "Exporting failed". 如果有 502 / EOF 见下
   ```

3. **SigNoz collector 收到数据？**
   ```bash
   docker logs signoz-otel-collector --since 5m 2>&1 | grep -iE "(ResourceTraces|radar)"
   ```

4. **已知坑提醒**：
   - `HTTP_PROXY` 让 gRPC 走 ClashX 代理 → 见 `docker/observability/docker-compose.yml` 的 `NO_PROXY` 是否含 `signoz-otel-collector`（22 文档风险表 #18）
   - 空 body curl 200 不代表真接受 — 走 receiver 短路

---

## 场景 7：trace_id 在浏览器和 Python 对不上

**症状**：浏览器 chip 显示 `abc123...`，Python log 显示 `xyz789...`。

**诊断**：OTel auto-propagation 被打断。通常原因：

1. **BFF 是否装了 `@opentelemetry/sdk-node`？**
   ```bash
   ls apps/web/src/instrumentation*.ts
   # 应该有 instrumentation.ts + instrumentation-node.ts
   ```

2. **BFF 是否有自定义 wrapper 覆盖 traceparent？**（Phase 1 ADR-002a 的老代码）
   ```bash
   grep -n "TracingLangGraphHttpAgent" apps/web/src/app/api/agent/chat/route.ts
   # 不应该有. 如果有是历史代码, Phase 3 已删 (commit 182b5fb)
   ```

3. **Python FastAPIInstrumentor 装了？**
   ```bash
   grep FastAPIInstrumentor agents/radar/src/radar/main.py
   # 应该 FastAPIInstrumentor.instrument_app(app)
   ```

4. **浏览器 fetch instrumentation 配了 propagateTraceHeaderCorsUrls？**
   ```bash
   grep propagateTraceHeaderCorsUrls apps/web/src/lib/otel-browser.ts
   # 应该 [/.*/]
   ```

任一缺失都会导致 trace_id 不贯穿。

---

## 场景 8：日常开发要不要跑 observability 栈？

**推荐矩阵**：

| 你在做什么 | 需要跑哪些 |
|---|---|
| 改 UI / 业务逻辑 | 啥都不跑（Python OTel 退化到 stdout）|
| 调 chat 流 / LangGraph node | Langfuse + OTel Collector |
| 排查跨端时序 / BFF 性能 | 全栈（SigNoz 额外） |
| 改 agui_tracing / 事件流 | 全栈 + 关 `REPAIR_AGUI_DEDUP` |
| 调错误处理 / 异常路径 | GlitchTip |

资源开销（M4 Pro 64GB）：全栈约 8-10 GB RAM，可接受。

---

## 常用 grep 组合

```bash
# Python log 按 trace_id 过滤
trace_id=ffa5814b77604beb85feeab79f5c65b0
grep "trace_id=$trace_id" /path/to/radar.log

# Collector debug stdout 看所有 span
docker compose -f docker/observability/docker-compose.yml logs -f | \
  grep -E "(ResourceTraces|service\.name)"

# GlitchTip 查最近 5 条 error (需要 admin API token)
curl -sS -H "Authorization: Bearer <token>" \
  "http://127.0.0.1:8002/api/0/organizations/agent-lab/issues/?limit=5"

# Langfuse 查 trace (需要 public_key + secret)
curl -sS -u "pk-lf-xxx:sk-lf-xxx" \
  "http://127.0.0.1:3010/api/public/traces/$trace_id"
```

---

## 维护约定

- 新增常见症状 → 追加到"决策树"表
- 新增自动化脚本 → 补到"常用 grep 组合"
- 新的坑被发现 → 加到 `docs/22 第 5 章风险表` + 这里对应场景
