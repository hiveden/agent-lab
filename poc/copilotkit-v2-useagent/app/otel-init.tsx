/**
 * PoC OTel 初始化片段 — 可直接 drop 到 `poc/copilotkit-v2-useagent/app/otel-init.tsx`
 *
 * 来源：`apps/web/src/components/OtelClientInit.tsx` + `apps/web/src/lib/otel-browser.ts`
 * （Phase 3 of docs/22 / ADR-007）
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 使用方式
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * 1. 拷贝本文件到：`poc/copilotkit-v2-useagent/app/otel-init.tsx`
 * 2. 在 `app/layout.tsx` 的 <body> 首行插入：
 *      <OtelInit />
 *      {children}
 * 3. 在 `.env.local` 配置：
 *      NEXT_PUBLIC_OTEL_COLLECTOR_URL=http://localhost:4318
 *      # 可选：
 *      NEXT_PUBLIC_SENTRY_DSN=<GlitchTip DSN>
 * 4. pnpm add 依赖（见 otel-deps.md）
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 关键差异 vs 生产
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * - service.name 改成 'agent-lab-poc-browser'，方便在 SigNoz/Langfuse 区分
 * - chat-trace EventTarget 保留（V3 / V4 证据需要拿 trace_id 显示到 UI）
 * - 不再读 NEXT_PUBLIC_GLITCHTIP_DSN（统一走 NEXT_PUBLIC_SENTRY_DSN）
 * - Sentry 可选：PoC 不验证错误聚合，未配 DSN 自动跳过
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * V3 / V4 验证 hook
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 在 page.tsx 里 import { otelTraceEvents } from './otel-init' 然后：
 *
 *   useEffect(() => {
 *     const handler = (e: Event) => {
 *       const { traceId } = (e as CustomEvent).detail;
 *       console.log('[poc] chat trace', traceId);
 *       setLastTraceId(traceId);
 *     };
 *     otelTraceEvents.addEventListener('chat-trace', handler);
 *     return () => otelTraceEvents.removeEventListener('chat-trace', handler);
 *   }, []);
 *
 * 把 traceId 显示到 UI → 复制到 Langfuse :3010 搜索框 → 应能查到 trace（V4 PASS）
 */

'use client';

import { useEffect } from 'react';

// ─── EventTarget：把 /api/agent/chat 出站 span 的 trace_id 派发给 UI ───
export const otelTraceEvents =
  typeof window !== 'undefined' ? new EventTarget() : undefined;

let started = false;

export function startBrowserOtel(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  // ── Sentry / GlitchTip 故意不接入 ──
  // PoC 7 项验证不覆盖错误聚合。若后续要加：
  //   pnpm add @sentry/nextjs
  //   const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  //   if (sentryDsn) import('@sentry/nextjs').then(S => S.init({ dsn: sentryDsn, ... }));

  // ── OTel Web SDK ──
  void (async () => {
    const [
      { WebTracerProvider, BatchSpanProcessor },
      { OTLPTraceExporter },
      { resourceFromAttributes },
      { ATTR_SERVICE_NAME },
      { ZoneContextManager },
      { registerInstrumentations },
      { FetchInstrumentation },
      { DocumentLoadInstrumentation },
    ] = await Promise.all([
      import('@opentelemetry/sdk-trace-web'),
      import('@opentelemetry/exporter-trace-otlp-http'),
      import('@opentelemetry/resources'),
      import('@opentelemetry/semantic-conventions'),
      import('@opentelemetry/context-zone'),
      import('@opentelemetry/instrumentation'),
      import('@opentelemetry/instrumentation-fetch'),
      import('@opentelemetry/instrumentation-document-load'),
    ]);

    const otlpEndpoint = (
      process.env.NEXT_PUBLIC_OTEL_COLLECTOR_URL || 'http://localhost:4318'
    ).replace(/\/$/, '');

    const provider = new WebTracerProvider({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: 'agent-lab-poc-browser',
      }),
      spanProcessors: [
        new BatchSpanProcessor(
          new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` }),
        ),
      ],
    });

    provider.register({
      contextManager: new ZoneContextManager(),
    });

    registerInstrumentations({
      instrumentations: [
        new DocumentLoadInstrumentation(),
        new FetchInstrumentation({
          propagateTraceHeaderCorsUrls: [/.*/],
          clearTimingResources: true,
          applyCustomAttributesOnSpan: (span) => {
            const sp = span as unknown as {
              attributes?: Record<string, unknown>;
              startTime?: [number, number];
              endTime?: [number, number];
            };
            const url = String(sp.attributes?.['http.url'] || '');
            if (!url.includes('/api/agent/chat')) return;

            const durMs =
              sp.endTime && sp.startTime
                ? (sp.endTime[0] - sp.startTime[0]) * 1000 +
                  (sp.endTime[1] - sp.startTime[1]) / 1e6
                : 0;
            if (durMs > 0 && durMs < 500) return; // 过滤 poll/health

            const traceId = span.spanContext().traceId;
            const g = globalThis as { __lastChatTraceId?: string };
            if (g.__lastChatTraceId === traceId) return;
            g.__lastChatTraceId = traceId;

            // eslint-disable-next-line no-console
            console.log(
              '[otel.fetch] chat-trace url=',
              url,
              'dur=',
              Math.round(durMs),
              'ms traceId=',
              traceId,
            );
            otelTraceEvents?.dispatchEvent(
              new CustomEvent('chat-trace', { detail: { traceId } }),
            );
          },
        }),
      ],
    });

    // eslint-disable-next-line no-console
    console.log('[otel] poc browser sdk started → ' + otlpEndpoint);
  })();
}

/**
 * 包成组件——在 RootLayout 使用：
 *   <OtelInit />
 */
export default function OtelInit() {
  useEffect(() => {
    startBrowserOtel();
  }, []);
  return null;
}
