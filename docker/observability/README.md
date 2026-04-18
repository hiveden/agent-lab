# OTel Collector (agent-lab 网关)

> 接收三端 (Browser / BFF / Python) 的 OTLP，双写到 Langfuse Cloud/自托管 + SigNoz 自托管。

## 架构角色

```
浏览器 OTel SDK ─┐
BFF Node OTel ───┤──→ agent-lab-otel-collector (:4317/:4318)
Python OTel  ────┘          │
                            ├─→ otlphttp/langfuse  (LLM 维度 trace)
                            └─→ otlphttp/signoz    (通用 trace/log/metric)
```

## 启动

```bash
bash docker/observability/start.sh
# start.sh 自动从 agents/radar/.env 读 LANGFUSE_PUBLIC_KEY/SECRET_KEY,
# base64 算 Basic Auth, 写 .env (gitignored), 启动 container
```

## 端口

- `:4317` OTLP gRPC (应用端推送)
- `:4318` OTLP HTTP (应用端推送; 含 CORS for browser)

## 配置文件

- `docker-compose.yml` — container 定义, NO_PROXY 白名单 (避 ClashX 走代理), 加入 `signoz-net` external network
- `otel-collector-config.yml` — receiver / processor / exporter pipeline
- `.env` — start.sh 自动生成 (含 LANGFUSE_AUTH_BASE64 + endpoint), gitignored
- `start.sh` — 封装启动 + 自动处理 Langfuse HOST 替换 `localhost → host.docker.internal`

## 关键配置点

**processors**:
- `memory_limiter`: 512 MiB 限 (必配, 不配会 OOM 干掉 collector — 风险表 #5)
- `batch/langfuse`: 1024 span/批
- `batch/signoz`: 200 span/批 (CopilotKit span attribute 体积大, 超 1MB 触发 SigNoz max_recv_msg_size 限制, 风险表 #20)

**pipelines**:
- 拆两条独立 pipeline (traces/langfuse + traces/signoz), 避免一端 429/timeout 阻塞另一端

**exporters**:
- `otlphttp/langfuse` — 发 `$LANGFUSE_OTEL_ENDPOINT`, Basic Auth header
- `otlp/signoz` — signoz-net 内部 gRPC `signoz-otel-collector:4317`, `tls.insecure: true`
- `debug` — 控制台输出 (排查用), verbosity normal

## 已知坑

1. **HTTP_PROXY 让 gRPC 走 ClashX** (grpc v1.78+ auto proxy) → NO_PROXY 白名单 host.docker.internal + signoz-otel-collector
2. **contrib v0.116 ≠ SigNoz v0.144 gRPC 兼容性** → 升 contrib 到 0.144.0 解决 (docker-compose.yml 固定版本)
3. **空 body curl /v1/traces 200 ≠ 真接受** → 走 receiver 短路, 验证用 telemetrygen

## 停止

```bash
cd docker/observability && docker compose down
```

## 详细文档

- [docs/22-OBSERVABILITY-ENTERPRISE.md ADR-003](../../docs/22-OBSERVABILITY-ENTERPRISE.md) — Collector 部署模式
- [docs/22 Phase 3 + Phase 4](../../docs/22-OBSERVABILITY-ENTERPRISE.md) — 实施细节
