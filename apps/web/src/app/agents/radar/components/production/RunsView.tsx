'use client';

import { useState, useCallback } from 'react';
import { useRuns, type Run } from '@/lib/hooks/use-runs';
import { cn } from '@/lib/utils';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

export interface RunsViewProps {
  onSelectRun?: (run: Run) => void;
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return '运行中…';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  return `${Math.floor(hours / 24)}天前`;
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

    const drainSSE = async (url: string) => {
      const res = await fetch(url, { method: 'POST' });
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    };

    try {
      await drainSSE('/api/cron/radar/ingest');
      await drainSSE('/api/cron/radar/evaluate');
    } catch {
      // ignore — runs list will reflect any failure
    } finally {
      setTriggerBusy(false);
      mutate();
    }
  }, [triggerBusy, mutate]);

  if (loading) {
    return <div className="runs-master-detail"><p className="text-[var(--text-3)] text-[13px] py-8 text-center">加载中…</p></div>;
  }

  return (
    <div className="runs-master-detail">
      {/* Left: Timeline */}
      <aside className="runs-sidebar">
        <div className="p-3 border-b border-[var(--border)] flex justify-between items-center">
          <span className="font-semibold text-[13px]">执行记录</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="trigger-btn" disabled={triggerBusy} onClick={handleTrigger}>
              {triggerBusy ? '运行中…' : '触发采集'}
            </button>
            <button className="sources-btn" onClick={() => mutate()}>刷新</button>
          </div>
        </div>
        <div>
          {runs.length === 0 ? (
            <p className="text-[var(--text-3)] text-[13px] py-8 text-center">暂无执行记录</p>
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
                    <span className={`run-phase ${run.phase}`}>{run.phase === 'ingest' ? '采集' : '评判'}</span>
                  </div>
                  <div className="run-entry-info">
                    <div className="run-entry-title">
                      {run.phase === 'ingest'
                        ? `新增 ${stats.inserted ?? 0} / 抓取 ${stats.fetched ?? 0}`
                        : `推荐 ${stats.promoted ?? 0} / 评判 ${stats.evaluated ?? 0}`}
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
            <p>选择一条记录查看详情</p>
          </div>
        )}
      </div>
    </div>
  );
}

function FunnelChart({ fetched, promoted, rejected }: { fetched: number; promoted: number; rejected: number }) {
  const funnelData = [
    { name: '抓取', value: fetched, fill: 'var(--text-2)' },
    { name: '推荐', value: promoted, fill: 'var(--green, #16a34a)' },
    { name: '淘汰', value: rejected, fill: 'var(--fire, #dc2626)' },
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
        { label: '抓取', value: stats.fetched ?? 0 },
        { label: '新增', value: stats.inserted ?? 0 },
        { label: '跳过', value: stats.skipped ?? 0 },
        { label: '耗时', value: formatDuration(run.started_at, run.finished_at) },
      ]
    : [
        { label: '评判', value: stats.evaluated ?? 0 },
        { label: '推荐', value: stats.promoted ?? 0, color: 'var(--green, #16a34a)' },
        { label: '淘汰', value: stats.rejected ?? 0 },
        { label: '耗时', value: formatDuration(run.started_at, run.finished_at) },
      ];

  // Funnel data (only meaningful for evaluate phase, but show for both if data exists)
  const fetched = stats.fetched ?? stats.evaluated ?? 0;
  const promoted = stats.promoted ?? stats.inserted ?? 0;
  const rejected = stats.rejected ?? stats.skipped ?? 0;
  const showFunnel = fetched > 0;

  return (
    <>
      <div className="run-detail-header">
        <h2>{run.phase === 'ingest' ? '采集' : '评判'}</h2>
        <span className={`status-badge ${run.status}`}>{run.status === 'done' ? '完成' : run.status === 'running' ? '运行中' : '失败'}</span>
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
          <h3 className="section-title">数据源</h3>
          <div className="run-sources-card">
            {run.source_ids.map((sid) => {
              const ps = perSource?.[sid];
              return (
                <div key={sid} className="source-row">
                  <div className="source-name">{sid}</div>
                  {ps?.fetched != null && (
                    <div className="source-count">{ps.fetched} 条</div>
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
            {run.phase === 'evaluate' ? '评判漏斗' : '采集漏斗'}
          </h3>
          <FunnelChart fetched={fetched} promoted={promoted} rejected={rejected} />
        </div>
      ) : null}

      {run.error ? (
        <div className="run-section">
          <h3 className="section-title">错误</h3>
          <div className="run-error-block">{run.error}</div>
        </div>
      ) : null}

      {run.trace && run.trace.length > 0 ? (
        <div className="run-section">
          <h3 className="section-title">执行链路 ({run.trace.length} 步)</h3>
          <pre className="run-trace-pre">{JSON.stringify(run.trace, null, 2)}</pre>
        </div>
      ) : null}
    </>
  );
}
