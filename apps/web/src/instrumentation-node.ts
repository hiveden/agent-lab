/**
 * BFF (Next.js Node runtime) OTel SDK + Sentry 初始化.
 * - OTel: Phase 3 of docs/22, BFF span 推 OTLP → collector → Langfuse + SigNoz
 * - Sentry: Phase 4 #3, BFF 服务端错误推 GlitchTip
 */

// Sentry init (放在 OTel 之前)
import * as Sentry from '@sentry/nextjs';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0,  // trace 走 OTel, Sentry 只做错误聚合
  });
}

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const otlpEndpoint = (
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318'
).replace(/\/$/, '');

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'agent-lab-web',
  }),
  traceExporter: new OTLPTraceExporter({
    url: `${otlpEndpoint}/v1/traces`,
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      // fs instrumentation 噪音太大, 关掉
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

sdk.start();
