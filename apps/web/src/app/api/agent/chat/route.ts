import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphHttpAgent } from "@copilotkit/runtime/langgraph";
import type { RunAgentInput } from "@ag-ui/core";

export const runtime = 'nodejs';

/**
 * BFF 端 trace_id 注入 — 详见 docs/22-OBSERVABILITY-ENTERPRISE.md ADR-002a。
 *
 * 为什么在 BFF 而非浏览器生成：CopilotKit v2 1.56.2 锁死了所有前端 per-request
 * 数据透传口子（runId / headers / properties / forwardedProps 都是 Provider
 * 构造期常量；core/index.mjs:1590 强制覆盖 agent.headers）。
 *
 * 等待 CopilotKit issue #3039 + #3456 落地后切回浏览器生成（W3C 标准做法）。
 *
 * 为什么 override requestInit 安全：CopilotKit `agent.headers = {...}` 只覆盖
 * 实例字段，不影响方法。requestInit 内部 super.requestInit(input) 拿到（被
 * 覆盖后的）headers，再叠加 traceparent。
 *
 * 关键设计：traceparent.trace_id 直接用 input.runId（去连字符的 32-hex），
 * 而不是 BFF 自己 randomUUID。这样四段 ID 天然对齐：
 *   - AG-UI BaseEvent.runId   = input.runId               (UUID)
 *   - W3C traceparent.traceId = input.runId.replace(-)    (32-hex)
 *   - Python OTel trace_id    = 同上                       (从 traceparent 提取)
 *   - LangChain config.run_id = UUID(int=traceId_int)     (Python 端注入)
 * 否则 ag-ui client 自动生成 input.runId 与 BFF randomUUID() 是两个独立 UUID。
 */
class TracingLangGraphHttpAgent extends LangGraphHttpAgent {
  protected requestInit(input: RunAgentInput): RequestInit {
    const base = super.requestInit(input);
    const traceId = input.runId.replace(/-/g, ''); // UUID → 32-hex
    const spanId = crypto.randomUUID().replace(/-/g, '').slice(0, 16); // 16-hex (任意)
    return {
      ...base,
      headers: {
        ...(base.headers as Record<string, string>),
        traceparent: `00-${traceId}-${spanId}-01`,
      },
    };
  }
}

const serviceAdapter = new ExperimentalEmptyAdapter();

const radarAgent = new TracingLangGraphHttpAgent({
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
