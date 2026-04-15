import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphHttpAgent } from "@copilotkit/runtime/langgraph";

export const runtime = 'nodejs';

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
