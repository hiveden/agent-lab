'use client';

import { useCallback, useEffect, useState } from 'react';

interface Run {
  id: string;
  agent_id: string;
  phase: string;
  status: string;
  source_ids: string[];
  stats: Record<string, unknown>;
  trace: unknown[];
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

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

export default function RunsView({ onSelectRun }: RunsViewProps) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/runs?agent_id=radar&limit=50');
      const data = (await res.json()) as { runs?: Run[] };
      setRuns(data.runs ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  if (loading) {
    return <div className="runs-view"><p className="runs-empty">Loading runs…</p></div>;
  }

  return (
    <div className="runs-view">
      <div className="runs-header">
        <h2>Runs</h2>
        <button className="sources-btn" onClick={fetchRuns}>Refresh</button>
      </div>

      {runs.length === 0 ? (
        <p className="runs-empty">No runs yet. Trigger a collection to start.</p>
      ) : (
        <div className="runs-list">
          {runs.map((run) => {
            const stats = run.stats as Record<string, number>;
            return (
              <div
                key={run.id}
                className={`run-card ${run.status}`}
                onClick={() => onSelectRun?.(run)}
              >
                <div className="run-card-header">
                  <span className={`run-phase ${run.phase}`}>{run.phase}</span>
                  <span className={`run-status ${run.status}`}>{run.status}</span>
                  <span className="run-time">{relativeTime(run.started_at)}</span>
                </div>
                <div className="run-card-stats">
                  {run.phase === 'ingest' && (
                    <>
                      {stats.fetched !== undefined && <span>Fetched: {stats.fetched}</span>}
                      {stats.inserted !== undefined && <span>New: {stats.inserted}</span>}
                      {stats.skipped !== undefined && <span>Dup: {stats.skipped}</span>}
                    </>
                  )}
                  {run.phase === 'evaluate' && (
                    <>
                      {stats.evaluated !== undefined && <span>Evaluated: {stats.evaluated}</span>}
                      {stats.promoted !== undefined && <span>Promoted: {stats.promoted}</span>}
                      {stats.rejected !== undefined && <span>Rejected: {stats.rejected}</span>}
                    </>
                  )}
                  <span className="run-duration">{formatDuration(run.started_at, run.finished_at)}</span>
                </div>
                {run.error && <div className="run-error">{run.error}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
