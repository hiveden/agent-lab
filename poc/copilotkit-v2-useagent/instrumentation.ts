/**
 * Next.js 15 instrumentation hook.
 * Next.js server 启动时自动调 register()。
 * PoC 只跑 nodejs runtime（见 app/api/agent/chat/route.ts `export const runtime = "nodejs"`）。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
