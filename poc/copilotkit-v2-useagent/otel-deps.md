# PoC OTel 依赖清单

> Worker B · Phase B2 · 给 Worker A / Phase C 的合并清单
> 来源：`apps/web/package.json` 已装版本 + `apps/web/src/lib/otel-browser.ts` 实际 import

---

## pnpm add（runtime deps）

```bash
pnpm add \
  @opentelemetry/api@^1.9.1 \
  @opentelemetry/context-zone@^2.7.0 \
  @opentelemetry/exporter-trace-otlp-http@^0.215.0 \
  @opentelemetry/instrumentation@^0.215.0 \
  @opentelemetry/instrumentation-document-load@^0.60.0 \
  @opentelemetry/instrumentation-fetch@^0.215.0 \
  @opentelemetry/resources@^2.7.0 \
  @opentelemetry/sdk-trace-web@^2.7.0 \
  @opentelemetry/semantic-conventions@^1.40.0
```

**可选**（只有验证错误聚合时才装）：
```bash
pnpm add @sentry/nextjs@^10.49.0
```

## package.json fragment（可直接 copy 到 PoC 项目）

```json
{
  "dependencies": {
    "@opentelemetry/api": "^1.9.1",
    "@opentelemetry/context-zone": "^2.7.0",
    "@opentelemetry/exporter-trace-otlp-http": "^0.215.0",
    "@opentelemetry/instrumentation": "^0.215.0",
    "@opentelemetry/instrumentation-document-load": "^0.60.0",
    "@opentelemetry/instrumentation-fetch": "^0.215.0",
    "@opentelemetry/resources": "^2.7.0",
    "@opentelemetry/sdk-trace-web": "^2.7.0",
    "@opentelemetry/semantic-conventions": "^1.40.0"
  }
}
```

## .env.local（PoC 项目）

```bash
# ── 必需 ──
# 本地自托管 OTel Collector（docker/observability/）——已启动
NEXT_PUBLIC_OTEL_COLLECTOR_URL=http://localhost:4318

# ── 可选 ──
# GlitchTip DSN（跑 V? 错误聚合时用；PoC 7 项没覆盖错误聚合，可不配）
# NEXT_PUBLIC_SENTRY_DSN=

# 若 PoC 自带一份 BFF runtime（方案 A），需要：
# RADAR_AGENT_BASE=http://localhost:8001
```

## 注意事项

1. **不要装 `@opentelemetry/sdk-node` / `auto-instrumentations-node`**——那是 BFF Node runtime 用的；浏览器侧纯 Web SDK。
2. **版本固定到 `^0.215.0` 系列**（experimental 包用 0.x）——混版本会报 API mismatch（OTel 生态常见坑）。
3. **Next 15 `instrumentation.ts`（server 侧）PoC 不需要**——V3 验证靠浏览器 span + BFF 既有 auto-propagation。PoC 方案 A 复用 `apps/web` 的 BFF 则自带；方案 B 独立 BFF 若要 Node OTel，再参考 `apps/web/src/instrumentation-node.ts`。
4. **Collector CORS**：默认 allowed origins 覆盖 `:8788`。PoC 若跑别的端口（如 `:3000`），OPTIONS 会被 collector 挡。解法：
   - 改 `docker/observability/config.yaml`（OTel Collector config）的 CORS allowed_origins 增加 PoC 端口；或
   - PoC 在与 `apps/web` 相同端口（停 `pnpm dev:web` 后跑 PoC）。
