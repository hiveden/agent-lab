# GlitchTip 自托管

> Sentry SDK 兼容的轻量错误聚合。替代 Sentry 自托管 (20+ 容器吃 8GB 的重量级) 的务实选择。
> 架构文档：[docs/22-OBSERVABILITY-ENTERPRISE.md ADR-006](../../docs/22-OBSERVABILITY-ENTERPRISE.md)

## 架构

```
三端 Sentry SDK → GlitchTip :8002
  (Python sentry-sdk[fastapi] + @sentry/nextjs server + browser)

GlitchTip:
  glitchtip-web (Django + uWSGI)
  glitchtip-worker (Celery + beat)
  postgres (元数据 + 事件)
  redis/valkey (任务队列, hostname 必须叫 "redis")
  migrate (一次性 Job)
```

## 端口

- `:8002` UI + Sentry envelope endpoint (host) → `:8000` (container)
  - 8000 被另一项目占用, 改 8002

## 启动

```bash
cd docker/glitchtip
docker compose up -d
# 等 ~30s
open http://127.0.0.1:8002
```

## 首次使用

1. 打开 http://127.0.0.1:8002
2. Sign Up (本地, 邮箱密码随便)
3. 建 Organization
4. 建 Team (slug 填小写字母数字, 比如 `radar`)
5. 建 Project (Platform 选 Python 或 JavaScript 都行)
6. Project → **Settings → Client Keys (DSN)** 复制

DSN 格式：`http://<public_key>@localhost:8002/<project_id>`

## 配置应用端

`agents/radar/.env`:
```bash
SENTRY_DSN=http://<public>@localhost:8002/<project_id>
```

`apps/web/.env.local`:
```bash
NEXT_PUBLIC_SENTRY_DSN=http://<public>@localhost:8002/<project_id>
SENTRY_DSN=<同上>
```

重启 Python agent + web，三端 Sentry SDK 自动 capture unhandled exception。

## 验证

**Python**:
```python
import sentry_sdk
sentry_sdk.capture_message("hello from python")
```

**浏览器 console**:
```js
throw new Error('hello from browser')
```

**BFF (Node)**: 任意 unhandled exception 自动 capture。

全都应该在 GlitchTip UI 的 Issues 列表出现。

## 已知坑

1. **GlitchTip 硬编码 `redis` hostname** → 即使用 `valkey/valkey` 镜像, service name 必须叫 `redis` 否则 500
2. **v5 frontend SPA 吃所有非 /api 路径** → 必须走 UI 注册不能用 curl `/api/0/auth/register/`
3. **v5.1 与 v4.2 数据库不兼容** → 不能从 v4 升级 db, 但全新部署 v5.1 OK
4. **不接收 Sentry SDK 2.0 部分新 feature** (profiling, metrics) → 不依赖这些高级功能; profiling 走 Pyroscope (未来 Phase 7), metrics 走 SigNoz

## 与 OTel trace_id 关联

Sentry SDK 2.x 自动从 OpenTelemetry current span 拿 `trace_id` 作为 error event 的 attribute。排查时可用同一 `trace_id` 在 Langfuse / SigNoz / GlitchTip 三端 grep。

## 停止 / 清理

```bash
docker compose down          # 保留数据 (Issues + 账号)
docker compose down -v       # 清数据
```

## 详细文档

- [docs/22 ADR-006](../../docs/22-OBSERVABILITY-ENTERPRISE.md) — GlitchTip vs Sentry 选型推理
- [docs/22 Phase 4 #3](../../docs/22-OBSERVABILITY-ENTERPRISE.md) — 三端 SDK 接入细节
