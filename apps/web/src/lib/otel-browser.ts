/**
 * 浏览器 OTel SDK 初始化 — Phase 3 of docs/22.
 *
 * 在 root layout 的 'use client' 包装组件 useEffect 调用一次。
 * 装 document-load + fetch instrumentation, 通过 OTLP/HTTP 把 span 发到本地
 * collector (:4318)。collector 配了 CORS allowed_origins=8788。
 *
 * 浏览器 OTel SDK 仍 experimental, 详见 docs/22 ADR-007 + Honeycomb browser
 * docs。在生产前需要复核 SDK 体积 (异步加载) + Sentry 等错误聚合的协同。
 */

import { WebTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';

/**
 * 派发当前 chat 的 OTel trace_id 给 UI (TraceLinkChip)。
 * fetch instrumentation 的 requestHook 拿到 /api/agent/chat 出站 span,
 * 把它的 trace_id (32-hex, 与 BFF/Python OTel trace_id 一致) 通过 EventTarget
 * 派发, React 组件监听更新。
 *
 * 详见 docs/22 ADR-002c — 由于 ag-ui input.runId 与 OTel trace_id 不再相等,
 * 前端必须用 OTel SDK 当前 span 的 trace_id 才能精准跳 Langfuse trace。
 */
export const otelTraceEvents = new EventTarget();

let started = false;

export function startBrowserOtel(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  // Sentry / GlitchTip 浏览器错误聚合 (Phase 4 #3 of docs/22)
  // 用 NEXT_PUBLIC_SENTRY_DSN 或 NEXT_PUBLIC_GLITCHTIP_DSN
  const sentryDsn =
    process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.NEXT_PUBLIC_GLITCHTIP_DSN;
  if (sentryDsn) {
    void import('@sentry/nextjs').then((Sentry) => {
      Sentry.init({
        dsn: sentryDsn,
        environment: process.env.NODE_ENV || 'development',
        tracesSampleRate: 0, // trace 走 OTel
      });
    });
  }

  const otlpEndpoint = (
    process.env.NEXT_PUBLIC_OTEL_COLLECTOR_URL || 'http://localhost:4318'
  ).replace(/\/$/, '');

  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'agent-lab-browser',
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
        // 跨源 fetch 必须显式 allow propagation, 否则 traceparent header 不发
        // 这里把 BFF /api/* 视为同源 (实际同源, 但 instrumentation 默认严格)
        propagateTraceHeaderCorsUrls: [/.*/],
        clearTimingResources: true,
        // OpenTelemetry FetchInstrumentation 的 applyCustomAttributesOnSpan
        // 可以从 span 自己的 attributes 拿 url (http.url), 比 requestHook 的
        // request 参数稳。span.attributes['http.url'] 才是 instrumentation
        // 真正写进的 URL。
        applyCustomAttributesOnSpan: (span) => {
          // 这里 span 是 ReadableSpan-like, 用 attributes / startTime / endTime 字段
          const sp = span as unknown as {
            attributes?: Record<string, unknown>;
            startTime?: [number, number];
            endTime?: [number, number];
          };
          const attrs = sp.attributes;
          const url = String(attrs?.['http.url'] || '');

          // 仅监听 CopilotRuntime 入口 (/api/agent/chat 透传到 Python /agent/chat).
          // 不匹配 /api/copilotkit (BFF 并未挂该 endpoint, 历史残留).
          if (!url.includes('/api/agent/chat')) return;

          // 过滤 CopilotKit 短暂 poll / 重连探测: 真实 chat SSE 从 connect 到
          // stream end 一般 >1s (含 LLM 调用时间), poll/healthcheck 类请求 <500ms.
          // 若浏览器 SDK 升级后 applyCustomAttributesOnSpan 语义变化,
          // 此检查 fallback 到"有 duration 才过滤", 0 表示不过滤保旧行为.
          const durMs = sp.endTime && sp.startTime
            ? (sp.endTime[0] - sp.startTime[0]) * 1000 + (sp.endTime[1] - sp.startTime[1]) / 1e6
            : 0;
          if (durMs > 0 && durMs < 500) return;

          const traceId = span.spanContext().traceId;

          // 同 trace_id 不重复 dispatch (防 instrumentation 内部的 retry/重采)
          if ((globalThis as { __lastChatTraceId?: string }).__lastChatTraceId === traceId) return;
          (globalThis as { __lastChatTraceId?: string }).__lastChatTraceId = traceId;

          // eslint-disable-next-line no-console
          console.log('[otel.fetch] chat-trace url=', url, 'dur=', Math.round(durMs), 'ms traceId=', traceId);
          otelTraceEvents.dispatchEvent(
            new CustomEvent('chat-trace', { detail: { traceId } }),
          );
        },
      }),
    ],
  });

  // 标记给 console 看
  // eslint-disable-next-line no-console
  console.log('[otel] browser sdk started → ' + otlpEndpoint);
}
