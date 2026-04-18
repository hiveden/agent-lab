/**
 * Next.js 15 instrumentation hook — Phase 3 of docs/22.
 *
 * Next.js server 启动时自动调 register()。
 * 只在 nodejs runtime 加载 OTel SDK (Edge runtime 跑不动 Node SDK,
 * Edge 端用 evanderkoogh/otel-cf-workers, ADR-008)。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node');
  }
}
