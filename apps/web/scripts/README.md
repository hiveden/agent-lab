# apps/web/scripts/

项目级脚本（独立于 Playwright e2e / pnpm scripts）。

## `verify-phase3-trace.mjs`

**用途**：headless playwright 自动触发一次 chat，验证浏览器 OTel SDK 启动 + fetch instrumentation 派出 trace_id + TraceLinkChip 显示短码。

**前置**：
- Next.js dev server `:8788` 已启
- Python Agent `:8001` 已启
- 可选：OTel Collector `:4318` 已启（未启时浏览器 OTLP 推送会 fail 但不阻塞验证本身）

**运行**：
```bash
cd apps/web
node scripts/verify-phase3-trace.mjs
```

**输出**：console 抓 `[otel]` / `[agui]` 相关 log，最后摘要：
```
=== 结果摘要 ===
  browser OTel started:  YES
  chip 短码 (8-hex):     abc12345
  agui runId (UUID):     (或 MISSING)
```

拿到 chip 短码（OTel trace_id 前 8 位）后可用于：
```bash
docker compose -f docker/observability/docker-compose.yml logs --tail=300 | grep <trace_id>
```

**创建背景**：[docs/22-OBSERVABILITY-ENTERPRISE.md Phase 3 #5 端到端验证](../../../docs/22-OBSERVABILITY-ENTERPRISE.md)。

**为什么独立脚本而非 Playwright e2e spec**：playwright.config.ts 的每个 project 用 testMatch 匹配特定 spec 文件，新加 spec 要改 config。独立 node 脚本更轻量，不需要 config 配合，直接用 `@playwright/test` 包里的 chromium API。
