/**
 * BFF (Next.js Node runtime) OTel SDK 初始化 — Phase 3 of docs/22.
 *
 * 装上 @opentelemetry/sdk-node + auto-instrumentations-node, 自动 instrument
 * fetch / http / express / undici 等。所有 BFF span 走 OTLP HTTP → 本地
 * collector (:4318) → Langfuse Cloud。
 *
 * trace_id 关联: incoming traceparent header 自动被 fetch instrumentation 接住,
 * 出站 fetch (LangGraphHttpAgent → Python) 自动 propagate。Phase 1 ADR-002a
 * 的 BFF override requestInit 仍生效 (从 input.runId 派生 traceparent),
 * 这条 traceparent 既送给 Python 也成为 BFF 这一层 fetch span 的关联键。
 */

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
