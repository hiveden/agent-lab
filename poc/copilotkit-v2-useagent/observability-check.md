# Observability Stack Check

> Worker B · Phase B3
> 日期：2026-04-21

---

## 启动命令

```bash
bash /Users/xuelin/projects/agent-lab/docker/start-all.sh
```

脚本顺序：Langfuse → SigNoz → GlitchTip → 等 30s → OTel Collector（`docker/observability/start.sh`）。

**本次检查**：4 个栈**已在运行**（`docker ps` 显示 Up 2 hours），无需重启。

## 容器状态（docker ps 摘录）

| 容器 | 状态 | 端口 |
|---|---|---|
| `agent-lab-otel-collector` | Up 2h | `:4317` gRPC + `:4318` HTTP |
| `signoz` | Up 2h (healthy) | `:3301` → 8080 |
| `signoz-otel-collector` | Up 2h | `:4327` gRPC + `:4328` HTTP（SigNoz 专用副本，不和 agent-lab-otel-collector 冲突） |
| `signoz-clickhouse` | Up 2h (healthy) | internal 8123/9000 |
| `signoz-zookeeper-1` | Up 2h (healthy) | internal |
| `langfuse-langfuse-web-1` | Up 2h | `:3010` → 3000 |
| `langfuse-langfuse-worker-1` | Up 2h | `:3040` → 3030 |
| `langfuse-clickhouse-1` | Up 2h (healthy) | `:8133` / `:9010` |
| `langfuse-postgres-1` | Up 2h (healthy) | `:5442` |
| `langfuse-redis-1` | Up 2h (healthy) | `:6389` |
| `langfuse-minio-1` | Up 2h (healthy) | `:9100` / `:9101` |
| `glitchtip-web` | Up 2h | `:8002` → 8000 |
| `glitchtip-worker` / `glitchtip-postgres` / `glitchtip-redis` / `glitchtip-valkey` | Up 2h | internal |
| `agent-lab-litellm` | Up 2h (unhealthy) | `:4000`（**注意：unhealthy**，但 PoC 不依赖 LiteLLM——Radar agent 直接走 LangChain / LiteLLM 作为 LLM gateway 才需；PoC 若跑真实 LLM 会受影响，见下方问题） |

## UI 入口

| 栈 | URL | 用途 |
|---|---|---|
| SigNoz | http://127.0.0.1:3301 | V4 全栈 trace（browser → BFF → Python） |
| Langfuse | http://127.0.0.1:3010 | V4 LLM trace + input/output |
| GlitchTip | http://127.0.0.1:8002 | 错误聚合（PoC 7 项未覆盖） |
| LiteLLM | http://127.0.0.1:4000 | LLM gateway API（无 UI，仅 API） |

## OTLP Endpoints（给 PoC 的 OTel SDK 用）

| 协议 | URL | 说明 |
|---|---|---|
| HTTP OTLP | `http://localhost:4318` | 浏览器 SDK + Python + BFF Node 默认推这里（`agent-lab-otel-collector`） |
| HTTP `/v1/traces` | `http://localhost:4318/v1/traces` | OTLPTraceExporter 具体路径 |
| gRPC OTLP | `http://localhost:4317` | Python / Node 用 gRPC exporter 时 |
| SigNoz 自己 | `:4327` gRPC / `:4328` HTTP | **不要直接推这里**，走 `agent-lab-otel-collector` 做 fan-out |

## 健康检查（curl 绕代理实测）

```bash
NO_PROXY=localhost,127.0.0.1 curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3301/   # → 200
NO_PROXY=localhost,127.0.0.1 curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3010/   # → 200
NO_PROXY=localhost,127.0.0.1 curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8002/   # → 200
NO_PROXY=localhost,127.0.0.1 curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"resourceSpans":[]}' -o /dev/null -w '%{http_code}' http://127.0.0.1:4318/v1/traces    # → 200
```

- [x] SigNoz 首页可访问（200）
- [x] Langfuse login 页可访问（200）
- [x] Collector OTLP HTTP `/v1/traces` accept POST（200）
- [x] GlitchTip 首页可访问（200）

## 问题 / 注意

1. **ClashX 代理干扰**
   - `curl http://localhost:*` 默认走 `HTTP_PROXY=socks5://127.0.0.1:7890` → 代理不识别 localhost → **52 Empty reply**。
   - 解法：`NO_PROXY=localhost,127.0.0.1` 或 `unset HTTP_PROXY HTTPS_PROXY`。
   - **对 PoC 前端不影响**：浏览器直接连 localhost，不走 ClashX。
   - **对 BFF Node OTel exporter 有影响**：Next.js server 若继承 shell 的 `HTTPS_PROXY` 环境变量，推 OTLP 到 `localhost:4318` 会被代理挡。`apps/web/package.json` / `pnpm dev:web` 脚本里应该已经清理（验证时注意）。

2. **LiteLLM 容器 unhealthy**
   - PoC 7 项（V1-V7）**不**依赖 LiteLLM healthcheck——Radar agent 跑 LLM 才要。
   - 若 PoC 要触发真实 LLM 响应（而不是 mock），需要先修 LiteLLM（或 `LLM_MOCK=1`）。
   - V1/V2 流式验证：**mock 模式也能观察流式 token**（假如 mock 按 chunk 产出）——先试 `LLM_MOCK=1`。

3. **Collector CORS**
   - 已允许 `:8788` 的浏览器跨源 POST。PoC 如果跑 `:3000` / `:3001`，Chrome OPTIONS 预检会被拦。
   - 验证方法：PoC 启动后打开 DevTools Network，看 `POST http://localhost:4318/v1/traces` 是否 200。失败则需改 `docker/observability/` 的 collector config `cors.allowed_origins`，再 `docker compose restart`。

4. **观测栈启动失败的降级方案**（预案，本次未触发）
   - V3/V4 可降级：Python 侧 `structlog` 日志在 `/tmp/radar-dev*.log`，trace_id 写在每条 log record 的 `trace_id` field。
   - BFF Node 侧若不起 OTel，也可 console.log traceparent header 值。
   - 对照实验：同一时刻点 PoC 发消息 → 从三端日志 grep 同一 trace_id，等价于 UI 验证。
