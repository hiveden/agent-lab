import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphHttpAgent } from "@copilotkit/runtime/langgraph";

export const runtime = "nodejs";

/**
 * PoC BFF runtime route — 复制自 apps/web/src/app/api/agent/chat/route.ts。
 * 方案 (A): PoC 自包含 runtime，避免跨端口 CORS。
 *
 * 契约说明（来自 contract-notes.md）：
 * - runtime agents 同时映射 `radar` 和 `default`
 * - v2 `useAgent()` 不传 agentId → 命中 `default` → radarAgent
 * - 下游 Python: ${RADAR_AGENT_BASE}/agent/chat (默认 http://localhost:8001)
 * - 无 auth（/agent/chat 路径不走 Bearer 校验）
 * - trace propagation 靠 OTel undici auto-instrumentation（不手动注入 traceparent）
 */

const serviceAdapter = new ExperimentalEmptyAdapter();

const radarAgent = new LangGraphHttpAgent({
  url: `${(process.env.RADAR_AGENT_BASE || "http://localhost:8001").replace(/\/+$/, "")}/agent/chat`,
});

const copilotRuntime = new CopilotRuntime({
  agents: {
    radar: radarAgent,
    default: radarAgent,
  },
});

export async function POST(req: Request) {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime: copilotRuntime,
    serviceAdapter,
    endpoint: "/api/agent/chat",
  });
  return handleRequest(req);
}
