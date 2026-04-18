# agent-lab 自托管可观测性栈

> **范围**：本目录下 4 个独立 docker-compose 项目，组成完整的 observability backbone。
> **定位**：排查 / 学习 / 企业级练兵场。日常开发**不需要**跑（Python OTel 会退化到 stdout）。
> **文档**：
> - 架构与 ADR：[`docs/22-OBSERVABILITY-ENTERPRISE.md`](../docs/22-OBSERVABILITY-ENTERPRISE.md)
> - 排查手册：[`docs/24-OBSERVABILITY-PLAYBOOK.md`](../docs/24-OBSERVABILITY-PLAYBOOK.md)

---

## 架构总览

```
三端 OTel SDK → agent-lab-otel-collector (:4317 / :4318)
                  │   (BatchSpanProcessor → 拆 2 条 pipeline)
                  ├───→ Langfuse 自托管 (:3010) — LLM trace + eval
                  └───→ SigNoz 自托管 (:4327 gRPC / :3301 UI) — 通用 trace/log/metric

  Sentry SDK 三端 → GlitchTip (:8002) — 错误聚合 (独立协议, 不过 collector)
```

---

## 端口总表

| 栈 | 子目录 | UI | 数据端口 | 资源占用 |
|---|---|---|---|---|
| OTel Collector | `docker/observability/` | — | **:4317** gRPC<br>**:4318** HTTP | 64 MB |
| SigNoz | `docker/signoz/` | **:3301** | :4327 gRPC / :4328 HTTP | ~4 GB |
| Langfuse 自托管 v3 | `docker/langfuse/` | **:3010** | :3010/api/public/otel | ~3 GB |
| GlitchTip | `docker/glitchtip/` | **:8002** | :8002 (Sentry protocol) | ~1 GB |

**总资源**：起全栈约 **8-10 GB RAM**，M4 Pro 64GB 轻松。

---

## 启动顺序（重要）

**1. Langfuse**（依赖：自带 PG + ClickHouse + Redis + MinIO 全部 self-contained）

```bash
cd docker/langfuse
docker compose up -d
# 等 ~60s（ClickHouse + 5 组件依次起来）
open http://127.0.0.1:3010   # 注册 admin → Settings → API Keys
```

**2. SigNoz**（依赖：ClickHouse + ZooKeeper）

```bash
cd docker/signoz
docker compose up -d
# 等 ~60s (含 telemetrystore-migrator 一次性 Job)
open http://127.0.0.1:3301
# 首次要注册 admin 激活 OPAMP:
curl -X POST http://127.0.0.1:3301/api/v1/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"admin","email":"admin@agent-lab.local","password":"AgentLab2026!","orgName":"agent-lab","orgId":""}'
```

**3. GlitchTip**（依赖：Postgres + Valkey）

```bash
cd docker/glitchtip
docker compose up -d
open http://127.0.0.1:8002    # UI 注册 → 建 Team → 建 Project → 复制 DSN
```

**4. OTel Collector**（最后启动，依赖上面所有服务的 endpoint）

```bash
cd docker/observability
bash start.sh   # 自动从 agents/radar/.env 读 LANGFUSE_* 配 Basic Auth
# collector 现在接三端 OTLP (:4317 gRPC / :4318 HTTP)
# 双写到 Langfuse + SigNoz
```

---

## 一键启动（推荐）

**`docker/start-all.sh`**（自动按上面顺序起）：

```bash
bash docker/start-all.sh
```

**`docker/stop-all.sh`**：

```bash
bash docker/stop-all.sh
```

---

## 关键 env 配置

`agents/radar/.env`：

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_HOST=http://localhost:3010   # 自托管; cloud 是 https://us.cloud.langfuse.com
SENTRY_DSN=http://<public>@localhost:8002/<project_id>
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=radar
LANGCHAIN_CALLBACKS_BACKGROUND=false   # Langfuse callback 必需
REPAIR_AGUI_DEDUP=1                    # agui_tracing 补丁层 (默认开)
```

`apps/web/.env.local`：

```bash
NEXT_PUBLIC_LANGFUSE_HOST=http://127.0.0.1:3010
NEXT_PUBLIC_LANGFUSE_PROJECT_ID=<从 Langfuse URL 抠>
NEXT_PUBLIC_SENTRY_DSN=http://<public>@localhost:8002/<project_id>
SENTRY_DSN=<同上>
```

---

## 日常开发工作流

**场景 A：写功能，不管 observability**
```bash
pnpm dev:web
cd agents/radar && uv run radar-serve
# 不起 docker, Python OTel 退化到 stdout 不阻塞
```

**场景 B：排查 chat 问题，要看 trace**
```bash
bash docker/start-all.sh   # 起全栈
pnpm dev:web
cd agents/radar && uv run radar-serve
# chat 一次 → 拿 trace_id → 开 Langfuse / SigNoz
```

**场景 C：查错误**
```bash
cd docker/glitchtip && docker compose up -d   # 只起 GlitchTip
# 错误自动 capture 到 :8002
```

---

## Cloud ↔ 自托管切换

**切 Cloud**（关闭自托管栈，用 Langfuse Cloud）：

1. 停自托管：`bash docker/stop-all.sh`（或只停 langfuse）
2. 改 `agents/radar/.env`：
   ```
   LANGFUSE_HOST=https://us.cloud.langfuse.com
   LANGFUSE_PUBLIC_KEY=<Cloud 的 key>
   LANGFUSE_SECRET_KEY=<Cloud 的 key>
   ```
3. 改 `apps/web/.env.local`: `NEXT_PUBLIC_LANGFUSE_HOST` 同步改
4. 如果要让 collector 仍双写到 Cloud：`bash docker/observability/start.sh`（会自动从 `.env` 读新 endpoint）

**切回自托管**：反向操作。

详见 [`docs/24-OBSERVABILITY-PLAYBOOK.md`](../docs/24-OBSERVABILITY-PLAYBOOK.md) "Cloud ↔ 自托管切换"章节。

---

## 子目录文档

- [`observability/README.md`](observability/README.md) — OTel Collector 详情
- [`signoz/README.md`](signoz/README.md) — SigNoz 详情
- [`langfuse/README.md`](langfuse/README.md) — Langfuse 自托管详情
- [`glitchtip/README.md`](glitchtip/README.md) — GlitchTip 详情

---

## 停止 / 清理

**停止（保留数据）：**
```bash
bash docker/stop-all.sh
```

**清理（删数据）：**
```bash
# 分别 down -v
for d in docker/observability docker/signoz docker/langfuse docker/glitchtip; do
  (cd $d && docker compose down -v)
done
```

清理后再次启动会丢失注册账号 / trace 历史 / 项目配置，要重新注册。
