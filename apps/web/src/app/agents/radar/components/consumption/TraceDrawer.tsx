'use client';

import { useEffect, useMemo, useState } from 'react';
import type { MockTrace, MockSpan } from '../../traceMock';

interface Props {
  open: boolean;
  trace: MockTrace | null;
  onClose: () => void;
  highlightSpanId: string | null;
  expandAllSignal: number;
  collapseAllSignal: number;
}

export default function TraceDrawer({
  trace,
  onClose,
  highlightSpanId,
  expandAllSignal,
  collapseAllSignal,
}: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // expand/collapse all
  useEffect(() => {
    if (!trace) return;
    const all: Record<string, boolean> = {};
    trace.spans.forEach((s) => (all[s.id] = true));
    setExpanded(all);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandAllSignal]);

  useEffect(() => {
    setExpanded({});
  }, [collapseAllSignal]);

  // auto-expand and scroll the highlighted span
  useEffect(() => {
    if (!highlightSpanId) return;
    setExpanded((prev) => ({ ...prev, [highlightSpanId]: true }));
    const el = document.querySelector(
      `[data-span-id="${highlightSpanId}"]`,
    ) as HTMLElement | null;
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlightSpanId]);

  const stats = useMemo(() => {
    if (!trace) return { spans: 0, tokens: 0, ms: 0 };
    return {
      spans: trace.spans.length,
      tokens: trace.totalTokens,
      ms: trace.totalMs,
    };
  }, [trace]);

  return (
      <aside className="trace-col">
        <div className="flex items-center gap-2.5 py-2.5 px-4 border-b border-[var(--border)] bg-[var(--surface-hi)] shrink-0">
          <h3 className="text-xs font-semibold">{trace?.source === 'push' ? 'Collection Trace' : 'Trace'}</h3>
          <span className="text-[11px] text-[var(--text-3)]">
            {trace?.source === 'push'
              ? 'radar-push pipeline'
              : 'agent execution log'}
          </span>
          <button
            className="icon-btn ml-auto"
            onClick={onClose}
            title="Close (esc)"
            aria-label="Close trace"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="trace-toolbar">
          <span className="stat">
            spans <b>{stats.spans}</b>
          </span>
          <span className="sep">·</span>
          <span className="stat">
            tokens <b>{stats.tokens || '—'}</b>
          </span>
          <span className="sep">·</span>
          <span className="stat">
            latency <b>{stats.ms ? (stats.ms / 1000).toFixed(2) + 's' : '—'}</b>
          </span>
        </div>
        <div className="trace-toolbar-actions">
          <button
            className="tbtn"
            onClick={() => {
              if (!trace) return;
              const all: Record<string, boolean> = {};
              trace.spans.forEach((s) => (all[s.id] = true));
              setExpanded(all);
            }}
          >
            expand all
          </button>
          <button className="tbtn" onClick={() => setExpanded({})}>
            collapse all
          </button>
        </div>
        <div className="trace-scroll">
          {!trace || trace.spans.length === 0 ? (
            <div className="trace-empty">
              <strong>No trace yet</strong>
              Send a message to see the agent&apos;s reasoning, tool calls and
              token budget.
            </div>
          ) : (
            trace.spans.map((s) => (
              <SpanNode
                key={s.id}
                span={s}
                expanded={!!expanded[s.id]}
                highlighted={s.id === highlightSpanId}
                onToggle={() =>
                  setExpanded((prev) => ({ ...prev, [s.id]: !prev[s.id] }))
                }
              />
            ))
          )}
        </div>
      </aside>
  );
}

function SpanNode({
  span,
  expanded,
  highlighted,
  onToggle,
}: {
  span: MockSpan;
  expanded: boolean;
  highlighted: boolean;
  onToggle: () => void;
}) {
  const hasBody = span.sections.length > 0;
  const status = span.status ?? 'done';
  return (
    <div
      data-span-id={span.id}
      className={`span ${hasBody ? 'has-body' : ''} ${
        expanded ? 'expanded' : ''
      } ${status} ${highlighted ? 'highlight' : ''}`}
    >
      <div className="span-row" onClick={onToggle}>
        <span className="span-caret">▶</span>
        <span className="span-status">
          <span className="ring" />
        </span>
        <span className={`span-kind ${span.kind}`}>
          {span.tool ?? span.kind}
        </span>
        <span className="span-title">{span.title}</span>
        {span.tokens ? (
          <span className="span-tokens">{span.tokens} tok</span>
        ) : (
          <span />
        )}
        <span className="span-time">
          {span.ms < 1000 ? `${span.ms}ms` : `${(span.ms / 1000).toFixed(2)}s`}
        </span>
      </div>
      {expanded && hasBody ? (
        <div className="span-body">
          {span.sections.map((sec, i) => (
            <div className="section" key={i}>
              <div className="section-head">
                <span className="section-label">{sec.label}</span>
                <button
                  className="copy-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard
                      .writeText(sec.body)
                      .catch(() => {});
                    const btn = e.currentTarget;
                    const prev = btn.textContent;
                    btn.textContent = 'copied';
                    setTimeout(() => {
                      btn.textContent = prev ?? 'copy';
                    }, 1200);
                  }}
                >
                  copy
                </button>
              </div>
              <div className="codeblock">{sec.body}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
