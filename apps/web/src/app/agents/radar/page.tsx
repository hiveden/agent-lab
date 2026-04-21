import { headers } from 'next/headers';
import RadarWorkspace from './RadarWorkspace';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import type { Viewport } from '@/lib/hooks/useViewport';

// Note: no edge runtime here — Radix UI (shadcn) needs Node SSR.
// API routes keep their own `export const runtime = 'edge'`.

/**
 * UA Client Hint 预判 Shell，降低首屏 CLS。
 *
 * - `Sec-CH-UA-Mobile: ?1` → compact
 * - 否则默认 expanded（保守估计；真实值在 client hydrate 后由 useViewport 纠正）
 *
 * medium 档 UA Hint 无法精准识别（iPad 横屏也可能是 mobile=?0），
 * 留给客户端 matchMedia 纠正——这是 Step 1 的已知限制，可接受。
 *
 * 若需精准区分，Next.js 15 支持 `viewport-width` Client Hint（需要响应
 * `Accept-CH: viewport-width`），Step 7 性能优化时再评估。
 */
async function guessInitialShell(): Promise<Viewport> {
  const h = await headers();
  const isMobile = h.get('sec-ch-ua-mobile') === '?1';
  return isMobile ? 'compact' : 'expanded';
}

export default async function RadarPage() {
  const initialShell = await guessInitialShell();
  return (
    <ErrorBoundary>
      <RadarWorkspace initialShell={initialShell} />
    </ErrorBoundary>
  );
}
