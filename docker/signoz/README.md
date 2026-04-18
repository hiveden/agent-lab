# SigNoz 自托管 (Phase 4 of docs/22)

完整 trace/log/metric backend, 与 Langfuse Cloud 双写。

## 架构

```
三端 OTel SDK → agent-lab-otel-collector (:4317/:4318)
                   │
                   ├─→ Langfuse Cloud (LLM 专用 trace + eval)
                   └─→ signoz-otel-collector (:4317 via signoz-net)
                         → ClickHouse (trace/log/metric 单后端)
                         → SigNoz UI (:3301)
```

端口避让（不与 agent-lab collector 冲突）：
- SigNoz OTLP gRPC host: 4327 (container 4317)
- SigNoz OTLP HTTP host: 4328 (container 4318)
- SigNoz UI host: 3301 (container 8080)

## 启动

```bash
cd docker/signoz
docker compose up -d

# 首次启动 OPAMP 会报 "cannot create agent without orgId",
# 注册 admin 后消失:
curl -X POST http://127.0.0.1:3301/api/v1/register \
  -H "Content-Type: application/json" \
  -d '{"name":"admin","email":"你的邮箱","password":"你的密码","orgName":"agent-lab","orgId":""}'
```

## 已知坑 (调研发现)

1. **telemetrystore-migrator Exited 是正常的** — 一次性 Job, ExitCode 必须 0
2. **注册前 collector OPAMP 报 "cannot create agent without orgId"** — 正常, 注册后消失
3. **contrib v0.116 + HTTP_PROXY 环境会让 gRPC 尝试通过 proxy 访问 signoz** — 必须 NO_PROXY 白名单 signoz-otel-collector
4. **空 body curl `/v1/traces` 返回 200 partialSuccess ≠ 真的接受** — 走 receiver 短路, 不进 pipeline。验证用 `telemetrygen traces --otlp-endpoint signoz-otel-collector:4317 --otlp-insecure`
5. **v0.116 与 SigNoz v0.144 有 gRPC 兼容性问题** — 升级 contrib 到 0.144.0 解决
6. **SigNoz collector OPAMP 下发的 batch max_size 可能压到 1MB** — CopilotKit/LangGraph span 体积大时分小批 (`send_batch_max_size: 200`)
7. **LGT 拆两条 pipeline 给 Langfuse + SigNoz** — 避免共用 batch 一端 429/timeout 卡住另一端

## 上游文件

- `docker-compose.yaml.orig`: SigNoz 官方 `deploy/docker/docker-compose.yaml` (v0.119.0) 原件
- `docker-compose.yaml`: 改了端口暴露的版本
- `otel-collector-config.yaml`: 官方 config + 加 `service.telemetry.logs.level: debug` 方便排查

## 升级

SigNoz 官方镜像 tag 在 `.env.signoz` 里 (VERSION / OTELCOL_TAG)。
升级前先看 [SigNoz changelog](https://signoz.io/changelog/) 是否有 breaking change (如 v0.113 telemetrystore-migrator 替换 schema-migrator)。
