"use client";

import type { ReactNode } from "react";
import { CopilotKit } from "@copilotkit/react-core/v2";

/**
 * IMPORTANT (issue #32 lesson):
 * `<CopilotKit>` v1 re-ran its agents-sync effect every render when callers
 * omitted optional props and let destructure defaults produce fresh `{}` refs.
 * Even on v2 we keep props referentially stable by hoisting empty objects to
 * module scope and freezing them. Do NOT inline `{}` / `[]` into JSX here.
 */
const EMPTY_HEADERS = Object.freeze({}) as Record<string, string>;
const EMPTY_PROPERTIES = Object.freeze({}) as Record<string, unknown>;

/**
 * PoC 方案 (A)：PoC 自包含 BFF runtime (app/api/agent/chat/route.ts)。
 * `runtimeUrl` 走同源相对路径，避免跨端口 CORS。
 */
const RUNTIME_URL =
  process.env.NEXT_PUBLIC_COPILOT_RUNTIME_URL ?? "/api/agent/chat";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <CopilotKit
      runtimeUrl={RUNTIME_URL}
      headers={EMPTY_HEADERS}
      properties={EMPTY_PROPERTIES}
    >
      {children}
    </CopilotKit>
  );
}
