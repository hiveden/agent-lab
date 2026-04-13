'use client';

import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { useRuns, type Run } from '@/lib/hooks/use-runs';
import { cn } from '@/lib/utils';
import { apiFetch, errorMessage } from '@/lib/fetch';
import { Button } from '@/components/ui/button';

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

interface SourceItem {
  id: string;
  name: string;
  source_type: string;
  enabled: boolean;
}

export default function RunsView({ onSelectRun }: RunsViewProps) {
  const { runs, isLoading: loading, mutate } = useRuns();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [triggerBusy, setTriggerBusy] = useState(false);
  const [sources, setSources] = useState<SourceItem[]>([]);

  useEffect(() => {
    apiFetch('/api/sources?agent_id=radar')
      .then((r) => r.json())
      .then((data) => setSources((data as { sources?: SourceItem[] }).sources ?? []))
      .catch((e) => toast.error(errorMessage(e)));
  }, []);

  const toggleSource = useCallback(async (s: SourceItem) => {
    try {
      await apiFetch(`/api/sources/${s.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: !s.enabled }),
      });
      setSources((prev) => prev.map((src) => src.id === s.id ? { ...src, enabled: !src.enabled } : src));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, []);

  const ingestRuns = runs.filter((r) => r.phase === 'ingest');
  const selected = ingestRuns.find((r) => r.id === selectedId) ?? null;
  const enabledCount = sources.filter((s) => s.enabled).length;

  const handleTrigger = useCallback(async () => {
    if (triggerBusy || enabledCount === 0) return;
    setTriggerBusy(true);

    const drainSSE = async (url: string): Promise<string | null> => {
      const res = await fetch(url, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string };
        return body.error ?? `HTTP ${res.status}`;
      }
      if (!res.body) return null;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let lastError: string | null = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'error') lastError = evt.message;
          } catch { /* skip */ }
        }
      }
      return lastError;
    };

    try {
      const sseError = await drainSSE('/api/cron/radar/ingest');
      if (sseError) toast.error(`采集失败: ${sseError}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setTriggerBusy(false);
      mutate();
    }
  }, [triggerBusy, enabledCount, mutate]);

  if (loading) {
    return <div className="runs-master-detail"><p className="text-[var(--text-3)] text-[13px] py-8 text-center">加载中…</p></div>;
  }

  return (
    <div className="runs-master-detail">
      <aside className="runs-sidebar">
        {/* Sources checkboxes */}
        <div className="p-3 border-b border-[var(--border)]">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-[13px]">数据源</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="trigger-btn" disabled={triggerBusy || enabledCount === 0} onClick={handleTrigger}>
                {triggerBusy ? '同步中…' : '同步'}
              </button>
              <Button variant="outline" size="sm" onClick={() => mutate()}>刷新</Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {sources.map((s) => (
              <label key={s.id} className="flex items-center gap-1.5 text-[12.5px] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={() => toggleSource(s)}
                  className="accent-[var(--accent)] w-3.5 h-3.5"
                />
                <span className={cn('text-[var(--text)]', !s.enabled && 'text-[var(--text-3)] line-through')}>
                  {s.name}
                </span>
              </label>
            ))}
            {sources.length === 0 && (
              <span className="text-[var(--text-3)] text-[12px]">暂无数据源</span>
            )}
          </div>
        </div>

        {/* Runs list */}
        <div className="p-3 pb-1 border-b border-[var(--border)]">
          <span className="font-semibold text-[12px] text-[var(--text-2)]">同步记录</span>
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

interface SourceInfo { id: string; name: string }

function RunDetail({ run }: { run: Run }) {
  const stats = run.stats as Record<string, number>;
  const perSource = (run.stats as Record<string, unknown>).per_source as
    | Record<string, { fetched?: number; ms?: number }>
    | undefined;

  const [rawItems, setRawItems] = useState<RawItem[]>([]);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [expandedSource, setExpandedSource] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/raw-items?run_id=${run.id}&limit=200`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setRawItems((data as { raw_items?: RawItem[] }).raw_items ?? []);
      })
      .catch(() => {});
    fetch('/api/sources?agent_id=radar')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setSources((data as { sources?: SourceInfo[] }).sources ?? []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [run.id]);

  const sourceNameMap = sources.reduce<Record<string, string>>((acc, s) => {
    acc[s.id] = s.name;
    return acc;
  }, {});

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
          <div className="flex flex-col gap-1">
            {run.source_ids.map((sid) => {
              const ps = perSource?.[sid];
              const sourceItems = itemsBySource[sid] ?? [];
              const isExpanded = expandedSource === sid;
              const count = ps?.fetched ?? sourceItems.length;
              const name = sourceNameMap[sid] ?? sid;
              const hasItems = sourceItems.length > 0;
              return (
                <div key={sid} className="border border-[var(--border)] rounded-[6px] overflow-hidden">
                  <div
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 text-[12.5px]',
                      hasItems && 'cursor-pointer hover:bg-[var(--bg-sunk)]',
                    )}
                    onClick={() => {
                      if (hasItems) setExpandedSource(isExpanded ? null : sid);
                    }}
                  >
                    <span className="text-[10px] text-[var(--text-3)] w-3">
                      {hasItems ? (isExpanded ? '▼' : '▶') : ''}
                    </span>
                    <span className="font-medium text-[var(--text)] flex-1">{name}</span>
                    <span className="text-[var(--text-2)] text-[11.5px]">{count} 条</span>
                    {ps?.ms != null && (
                      <span className="text-[var(--text-3)] text-[11px]">{(ps.ms / 1000).toFixed(1)}s</span>
                    )}
                  </div>
                  {isExpanded && hasItems && (
                    <div className="border-t border-[var(--border)] bg-[var(--bg-sunk)] px-3 py-1.5 flex flex-col">
                      {sourceItems.map((item) => (
                        <div key={item.id} className="flex items-center gap-2 py-1.5 text-[12px] border-b border-[var(--border)] last:border-0">
                          <span className="text-[var(--text)] flex-1 min-w-0 truncate">{item.title}</span>
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
