/**
 * PoC BFF (Next.js Node runtime) OTel SDK.
 * 复制自 apps/web/src/instrumentation-node.ts，去掉 Sentry（PoC 不装 @sentry/nextjs）。
 *
 * 作用：undici auto-instrumentation 自动把入站 traceparent 透传到出站 fetch
 * (BFF → Python /agent/chat)，实现 trace_id 三端贯穿（ADR-002c）。
 */

import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

const otlpEndpoint = (
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4318"
).replace(/\/$/, "");

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || "agent-lab-poc-bff",
  }),
  traceExporter: new OTLPTraceExporter({
    url: `${otlpEndpoint}/v1/traces`,
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-fs": { enabled: false },
    }),
  ],
});

sdk.start();
