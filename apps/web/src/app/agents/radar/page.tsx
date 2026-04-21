import { Suspense } from 'react';
import RadarWorkspace from './RadarWorkspace';
import { ErrorBoundary } from '@/components/ErrorBoundary';

// Note: no edge runtime here — Radix UI (shadcn) needs Node SSR.
// API routes keep their own `export const runtime = 'edge'`.

// RadarWorkspace 内部用了 `useSearchParams`（Step 2 URL-as-state），
// Next.js 15 要求这类 hook 必须在 Suspense 边界下才能参与静态生成。
// 首帧渲染空壳（viewport=undefined 时 RadarWorkspace 自己也返回骨架），
// hydrate 后 Zustand + URL + matchMedia 一起到位。
export default function RadarPage() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<div className="grid grid-rows-[40px_1fr] h-screen" />}>
        <RadarWorkspace />
      </Suspense>
    </ErrorBoundary>
  );
}
