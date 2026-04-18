import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphHttpAgent } from "@copilotkit/runtime/langgraph";

export const runtime = 'nodejs';

/**
 * Phase 3 修正 (ADR-002c, supersedes ADR-002a):
 *
 * 不再 wrap LangGraphHttpAgent 手动注入 traceparent。BFF Node OTel SDK
 * (auto-instrumentations-node 的 undici/fetch instrumentation) 自动 propagate
 * 入站 traceparent 到出站 fetch (W3C 标准)，trace_id 三段串通靠 OTel context
 * 自动维护，不需要应用代码干预。
 *
 * Phase 1 ADR-002a 的 BFF 手动注入与 Phase 3 OTel auto-propagation 冲突 (覆盖
 * 了入站 trace_id), 所以三端走出独立 trace_id。删除 wrapper 后修复。
 *
 * 代价: AG-UI BaseEvent.runId (ag-ui client 自动生成) 不再 == OTel trace_id。
 * 前端 trace 关联改用浏览器 OTel SDK 当前 span 的 trace_id (TraceLinkChip 改造)。
 *
 * 详见 docs/22-OBSERVABILITY-ENTERPRISE.md ADR-002c (Phase 3 修正)。
 */

const serviceAdapter = new ExperimentalEmptyAdapter();

const radarAgent = new LangGraphHttpAgent({
  url: `${(process.env.RADAR_AGENT_BASE || "http://localhost:8001").replace(/\/+$/, '')}/agent/chat`,
});

const copilotRuntime = new CopilotRuntime({
  agents: {
    radar: radarAgent,
    default: radarAgent,  // v2 useAgent() without agentId looks for 'default'
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
