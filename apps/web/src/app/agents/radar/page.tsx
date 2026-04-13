import RadarWorkspace from './RadarWorkspace';
import { ErrorBoundary } from '@/components/ErrorBoundary';

// Note: no edge runtime here — Radix UI (shadcn) needs Node SSR.
// API routes keep their own `export const runtime = 'edge'`.

export default function RadarPage() {
  return (
    <ErrorBoundary>
      <RadarWorkspace />
    </ErrorBoundary>
  );
}
