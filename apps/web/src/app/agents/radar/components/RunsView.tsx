'use client';

import { useState, useCallback } from 'react';
import { useRuns, type Run } from '@/lib/hooks/use-runs';
import { cn } from '@/lib/utils';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

export interface RunsViewProps {
  onSelectRun?: (run: Run) => void;
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return 'running…';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function RunsView({ onSelectRun }: RunsViewProps) {
  const { runs, isLoading: loading, mutate } = useRuns();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [triggerBusy, setTriggerBusy] = useState(false);

  const selected = runs.find((r) => r.id === selectedId) ?? null;

  const handleTrigger = useCallback(async () => {
    if (triggerBusy) return;
    setTriggerBusy(true);
    try {
      await fetch('/api/cron/radar/ingest', { method: 'POST' });
      await fetch('/api/cron/radar/evaluate', { method: 'POST' });
    } catch {
      // ignore — runs list will reflect any failure
    } finally {
      setTriggerBusy(false);
      mutate();
    }
  }, [triggerBusy, mutate]);

  if (loading) {
    return <div className="runs-master-detail"><p className="text-[var(--text-3)] text-[13px] py-8 text-center">Loading runs…</p></div>;
  }

  return (
    <div className="runs-master-detail">
      {/* Left: Timeline */}
      <aside className="runs-sidebar">
        <div className="p-3 border-b border-[var(--border)] flex justify-between items-center">
          <span className="font-semibold text-[13px]">Runs</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="trigger-btn" disabled={triggerBusy} onClick={handleTrigger}>
              {triggerBusy ? 'Running…' : 'Trigger'}
            </button>
            <button className="sources-btn" onClick={() => mutate()}>Refresh</button>
          </div>
        </div>
        <div>
          {runs.length === 0 ? (
            <p className="text-[var(--text-3)] text-[13px] py-8 text-center">No runs yet.</p>
          ) : (
            runs.map((run) => {
              const stats = run.stats as Record<string, number>;
              const isSelected = run.id === selectedId;
              return (
                <div
                  key={run.id}
                  className={cn(
                    'run-entry',
                    isSelected && 'selected',
                  )}
                  onClick={() => {
                    setSelectedId(run.id);
                    onSelectRun?.(run);
                  }}
                >
                  <div className="run-entry-phases">
                    <span className={`run-phase ${run.phase}`}>{run.phase}</span>
                  </div>
                  <div className="run-entry-info">
                    <div className="run-entry-title">
                      {run.phase === 'ingest'
                        ? `${stats.inserted ?? 0} new / ${stats.fetched ?? 0} fetched`
                        : `${stats.promoted ?? 0} promoted / ${stats.evaluated ?? 0} eval`}
                    </div>
                    <div className="run-entry-stats">
                      {formatDuration(run.started_at, run.finished_at)}
                    </div>
                  </div>
                  <div className="run-entry-meta">
                    <span className={`run-status ${run.status}`}>
                      {run.status === 'done' ? '\u2713' : run.status === 'running' ? '\u25CF' : '\u2717'}
                    </span>
                    <span className="run-entry-time">{relativeTime(run.started_at)}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Right: Detail */}
      <div className="run-detail">
        {selected ? (
          <RunDetail run={selected} />
        ) : (
          <div className="run-detail-empty">
            <p>Select a run to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}

function FunnelChart({ fetched, promoted, rejected }: { fetched: number; promoted: number; rejected: number }) {
  const funnelData = [
    { name: 'Fetched', value: fetched, fill: 'var(--text-2)' },
    { name: 'Promoted', value: promoted, fill: 'var(--green, #16a34a)' },
    { name: 'Rejected', value: rejected, fill: 'var(--fire, #dc2626)' },
  ];

  return (
    <ResponsiveContainer width="100%" height={120}>
      <BarChart data={funnelData} layout="vertical" margin={{ left: 60, right: 20 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} />
        <Tooltip />
        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
          {funnelData.map((entry, i) => (
            <Cell key={i} fill={entry.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function RunDetail({ run }: { run: Run }) {
  const stats = run.stats as Record<string, number>;
  const perSource = (run.stats as Record<string, unknown>).per_source as
    | Record<string, { fetched?: number; ms?: number }>
    | undefined;

  const statCards = run.phase === 'ingest'
    ? [
        { label: 'Fetched', value: stats.fetched ?? 0 },
        { label: 'Inserted', value: stats.inserted ?? 0 },
        { label: 'Skipped', value: stats.skipped ?? 0 },
        { label: 'Duration', value: formatDuration(run.started_at, run.finished_at) },
      ]
    : [
        { label: 'Evaluated', value: stats.evaluated ?? 0 },
        { label: 'Promoted', value: stats.promoted ?? 0, color: 'var(--green, #16a34a)' },
        { label: 'Rejected', value: stats.rejected ?? 0 },
        { label: 'Duration', value: formatDuration(run.started_at, run.finished_at) },
      ];

  // Funnel data (only meaningful for evaluate phase, but show for both if data exists)
  const fetched = stats.fetched ?? stats.evaluated ?? 0;
  const promoted = stats.promoted ?? stats.inserted ?? 0;
  const rejected = stats.rejected ?? stats.skipped ?? 0;
  const showFunnel = fetched > 0;

  return (
    <>
      <div className="run-detail-header">
        <h2>{run.phase} run</h2>
        <span className={`status-badge ${run.status}`}>{run.status}</span>
        <span className="run-detail-time">{formatTime(run.started_at)}</span>
      </div>

      <div className="stats-grid">
        {statCards.map((s) => (
          <div className="stat-card" key={s.label}>
            <div className="stat-label">{s.label}</div>
            <div className="stat-value" style={'color' in s ? { color: s.color } : undefined}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Per-source breakdown */}
      {run.source_ids.length > 0 ? (
        <div className="run-section">
          <h3 className="section-title">Sources</h3>
          <div className="run-sources-card">
            {run.source_ids.map((sid) => {
              const ps = perSource?.[sid];
              return (
                <div key={sid} className="source-row">
                  <div className="source-name">{sid}</div>
                  {ps?.fetched != null && (
                    <div className="source-count">{ps.fetched} items</div>
                  )}
                  {ps?.ms != null && (
                    <div className="source-time">{(ps.ms / 1000).toFixed(1)}s</div>
                  )}
                  {!ps && <div className="source-time" style={{ color: 'var(--text-3)' }}>--</div>}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Funnel visualization */}
      {showFunnel ? (
        <div className="run-section">
          <h3 className="section-title">
            {run.phase === 'evaluate' ? 'Evaluate \u2014 Funnel' : 'Ingest \u2014 Funnel'}
          </h3>
          <FunnelChart fetched={fetched} promoted={promoted} rejected={rejected} />
        </div>
      ) : null}

      {run.error ? (
        <div className="run-section">
          <h3 className="section-title">Error</h3>
          <div className="run-error-block">{run.error}</div>
        </div>
      ) : null}

      {run.trace && run.trace.length > 0 ? (
        <div className="run-section">
          <h3 className="section-title">Trace ({run.trace.length} spans)</h3>
          <pre className="run-trace-pre">{JSON.stringify(run.trace, null, 2)}</pre>
        </div>
      ) : null}
    </>
  );
}
