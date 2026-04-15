import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphHttpAgent } from "@copilotkit/runtime/langgraph";

export const runtime = 'nodejs';

const serviceAdapter = new ExperimentalEmptyAdapter();

const copilotRuntime = new CopilotRuntime({
  agents: {
    radar: new LangGraphHttpAgent({
      url: `${(process.env.RADAR_AGENT_BASE || "http://localhost:8001").replace(/\/+$/, '')}/agent/chat`,
    }),
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
