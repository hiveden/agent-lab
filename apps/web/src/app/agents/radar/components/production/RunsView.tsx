'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRuns, type Run } from '@/lib/hooks/use-runs';
import { cn } from '@/lib/utils';

export interface RunsViewProps {
  onSelectRun?: (run: Run) => void;
}

interface RawItem {
  id: string;
  source_id: string;
  title: string;
  url: string | null;
  external_id: string;
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return '同步中…';
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

  const ingestRuns = runs.filter((r) => r.phase === 'ingest');
  const selected = ingestRuns.find((r) => r.id === selectedId) ?? null;

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
      <aside className="runs-sidebar">
        <div className="p-3 border-b border-[var(--border)] flex justify-between items-center">
          <span className="font-semibold text-[13px]">同步记录</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="trigger-btn" disabled={triggerBusy} onClick={handleTrigger}>
              {triggerBusy ? '同步中…' : '同步'}
            </button>
            <button className="sources-btn" onClick={() => mutate()}>刷新</button>
          </div>
        </div>
        <div>
          {ingestRuns.length === 0 ? (
            <p className="text-[var(--text-3)] text-[13px] py-8 text-center">暂无同步记录</p>
          ) : (
            ingestRuns.map((run) => {
              const stats = run.stats as Record<string, number>;
              const isSelected = run.id === selectedId;
              return (
                <div
                  key={run.id}
                  className={cn('run-entry', isSelected && 'selected')}
                  onClick={() => {
                    setSelectedId(run.id);
                    onSelectRun?.(run);
                  }}
                >
                  <div className="run-entry-info">
                    <div className="run-entry-title">
                      新增 {stats.inserted ?? 0} / 抓取 {stats.fetched ?? 0}
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

function RunDetail({ run }: { run: Run }) {
  const stats = run.stats as Record<string, number>;
  const perSource = (run.stats as Record<string, unknown>).per_source as
    | Record<string, { fetched?: number; ms?: number }>
    | undefined;

  const [rawItems, setRawItems] = useState<RawItem[]>([]);
  const [expandedSource, setExpandedSource] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/raw-items?run_id=${run.id}&limit=200`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setRawItems((data as { raw_items?: RawItem[] }).raw_items ?? []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [run.id]);

  const itemsBySource = rawItems.reduce<Record<string, RawItem[]>>((acc, item) => {
    const key = item.source_id;
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  const statCards = [
    { label: '抓取', value: stats.fetched ?? 0 },
    { label: '新增', value: stats.inserted ?? 0 },
    { label: '重复', value: stats.skipped ?? 0 },
    { label: '耗时', value: formatDuration(run.started_at, run.finished_at) },
  ];

  return (
    <>
      <div className="run-detail-header">
        <h2>同步</h2>
        <span className={`status-badge ${run.status}`}>
          {run.status === 'done' ? '完成' : run.status === 'running' ? '同步中' : '失败'}
        </span>
        <span className="run-detail-time">{formatTime(run.started_at)}</span>
      </div>

      <div className="stats-grid">
        {statCards.map((s) => (
          <div className="stat-card" key={s.label}>
            <div className="stat-label">{s.label}</div>
            <div className="stat-value">{s.value}</div>
          </div>
        ))}
      </div>

      {run.source_ids.length > 0 && (
        <div className="run-section">
          <h3 className="section-title">各数据源</h3>
          <div className="run-sources-card">
            {run.source_ids.map((sid) => {
              const ps = perSource?.[sid];
              const sourceItems = itemsBySource[sid] ?? [];
              const isExpanded = expandedSource === sid;
              return (
                <div key={sid}>
                  <div
                    className={cn('source-row', sourceItems.length > 0 && 'cursor-pointer')}
                    onClick={() => {
                      if (sourceItems.length > 0) {
                        setExpandedSource(isExpanded ? null : sid);
                      }
                    }}
                  >
                    {sourceItems.length > 0 && (
                      <span className="text-[10px] text-[var(--text-3)] mr-1">{isExpanded ? '▼' : '▶'}</span>
                    )}
                    <div className="source-name">{sid}</div>
                    {ps?.fetched != null && (
                      <div className="source-count">{ps.fetched} 条</div>
                    )}
                    {ps?.ms != null && (
                      <div className="source-time">{(ps.ms / 1000).toFixed(1)}s</div>
                    )}
                    {!ps && <div className="source-time" style={{ color: 'var(--text-3)' }}>--</div>}
                  </div>
                  {isExpanded && sourceItems.length > 0 && (
                    <div className="pl-5 pb-2 flex flex-col gap-1.5">
                      {sourceItems.map((item) => (
                        <div key={item.id} className="flex items-start gap-2 text-[12px] leading-[1.5] py-1 border-b border-[var(--border)] last:border-0">
                          <span className="text-[var(--text)] flex-1 min-w-0">{item.title}</span>
                          {item.url && (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[var(--accent)] shrink-0 text-[11px] hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              ↗
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {run.error && (
        <div className="run-section">
          <h3 className="section-title">错误</h3>
          <div className="run-error-block">{run.error}</div>
        </div>
      )}

      {run.trace && run.trace.length > 0 && (
        <div className="run-section">
          <h3 className="section-title">执行链路 ({run.trace.length} 步)</h3>
          <pre className="run-trace-pre">{JSON.stringify(run.trace, null, 2)}</pre>
        </div>
      )}
    </>
  );
}
