'use client';

import type { MockTrace, SpanKind } from '../../traceMock';

interface Props {
  trace: MockTrace;
  onOpenSpan: (spanId: string) => void;
}

function capLabel(kind: SpanKind, tool?: string): string {
  if (kind === 'tool' && tool) return `tool·${tool}`;
  return kind;
}

export default function InlineTraceRail({ trace, onOpenSpan }: Props) {
  const spans = trace.spans;
  return (
    <div className="trace-rail" role="group" aria-label="trace capsules">
      {spans.map((s, i) => (
        <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center' }}>
          <button
            type="button"
            className={`trace-cap kind-${s.kind} ${trace.mock ? 'mock' : ''}`}
            onClick={() => onOpenSpan(s.id)}
            title={s.title}
          >
            {capLabel(s.kind, s.tool)}
          </button>
          {i < spans.length - 1 ? (
            <span className="trace-rail-arrow" aria-hidden>
              →
            </span>
          ) : null}
        </span>
      ))}
      <span className="trace-rail-sum">
        {trace.totalTokens || '—'} tok ·{' '}
        {(trace.totalMs / 1000).toFixed(1)}s
      </span>
    </div>
  );
}
