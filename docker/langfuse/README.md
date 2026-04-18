# Langfuse 自托管 v3

> LLM 专用 trace + eval + prompt management。替代 Langfuse Cloud 做完整数据主权。
> 架构文档：[docs/22-OBSERVABILITY-ENTERPRISE.md ADR-005](../../docs/22-OBSERVABILITY-ENTERPRISE.md)

## 架构

```
Langfuse v3 self-contained (6 组件):

langfuse-web (UI + API :3010)
langfuse-worker (ingest + eval)
    │
    ├─→ postgres :5442  (元数据)
    ├─→ clickhouse :8133 (trace spans + events)
    ├─→ redis :6389    (任务队列)
    └─→ minio :9100    (S3 对象存储, prompt/ dataset/ 等)
```

## 端口（避让其他项目, host port +10）

| 服务 | host port | container port |
|---|---|---|
| langfuse-web UI + API | **3010** | 3000 |
| langfuse-worker | 3040 | 3030 |
| postgres | 5442 | 5432 |
| clickhouse HTTP | 8133 | 8123 |
| clickhouse native | 9010 | 9000 |
| minio S3 | 9100 | 9000 |
| minio console | 9101 | 9001 |
| redis | 6389 | 6379 |

## 启动

```bash
cd docker/langfuse
docker compose up -d
# 等 ~60s (6 组件依次 healthy), langfuse-web 可能进 restart loop
# (postgres 还没 healthy 它就启动, 一次重启后自愈)
```

## 首次使用

1. 打开 http://127.0.0.1:3010
2. Sign up (本地, 随便填 email + 强密码)
3. 建 Organization → 建 Project (比如叫 `radar`)
4. Settings → API Keys → 复制 **Public Key** + **Secret Key**
5. 从浏览器 URL 抠 **Project ID** (`/project/<这段>/...`)

## 配置应用端

`agents/radar/.env`:

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_HOST=http://localhost:3010
```

`apps/web/.env.local`:

```bash
NEXT_PUBLIC_LANGFUSE_HOST=http://127.0.0.1:3010
NEXT_PUBLIC_LANGFUSE_PROJECT_ID=<从 URL 抠的>
```

然后重启 Python agent + web，触发一次 chat，Langfuse UI 即可看到完整 trace tree。

## 与 OTel Collector 集成

Collector 推到 `http://host.docker.internal:3010/api/public/otel/v1/traces` (见 `../observability/start.sh` 自动处理 localhost → host.docker.internal 替换)。

## 已知坑

1. **web 启动比 postgres healthy 快** → restart loop 一次自愈
2. **端口冲突**：6379 可能被其他项目 redis 占, 所以 host port +10 到 6389
3. **只 index 含 LLM 框架 attribute 的 trace**：浏览器 fetch / BFF undici 的 generic HTTP trace 不建 Langfuse 条目，必须触发真实 chat (含 LangGraph span) 才能在 UI 查到
4. **ClickHouse 升级 breaking**: 锁定主版本, 升级前完整备份

## 切 Langfuse Cloud

改 `LANGFUSE_HOST=https://us.cloud.langfuse.com` + 用 Cloud 的 PUBLIC/SECRET key。Cloud/自托管可随时切换, 数据不互通。详见 [`docs/24-OBSERVABILITY-PLAYBOOK.md`](../../docs/24-OBSERVABILITY-PLAYBOOK.md)。

## 停止 / 清理

```bash
docker compose down          # 保留数据
docker compose down -v       # 清数据 (所有 trace + 账号 + project 丢失)
```

## 详细文档

- [docs/22 ADR-005](../../docs/22-OBSERVABILITY-ENTERPRISE.md) — 选型 Langfuse 的推理
- [docs/22 Phase 2 + Phase 4 #4](../../docs/22-OBSERVABILITY-ENTERPRISE.md) — Cloud → 自托管演进
