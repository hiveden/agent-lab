'use client';

import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface SourceDetail {
  total_items: number;
  consumed: number;
  watching: number;
  discussed: number;
  dismissed: number;
  chat_rounds: number;
}

interface SourceAttention {
  source_id: string;
  source_name: string;
  source_type: string;
  expected_weight: number;
  actual_weight: number;
  deviation: number;
  raw_score: number;
  detail: SourceDetail;
}

interface Snapshot {
  agent_id: string;
  computed_at: string;
  total_score: number;
  sources: SourceAttention[];
  weights_config: Record<string, number>;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function deviationLabel(d: number): { text: string; cls: string } {
  const absPct = Math.abs(d * 100).toFixed(0);
  if (d > 0.05) return { text: `+${absPct}% over`, cls: 'dev-over' };
  if (d < -0.05) return { text: `-${absPct}% under`, cls: 'dev-under' };
  return { text: 'on track', cls: 'dev-ok' };
}

export default function AttentionView() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/attention/snapshot?agent_id=radar');
      const data = (await res.json()) as Snapshot;
      setSnapshot(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch_();
  }, [fetch_]);

  if (loading) {
    return <div className="max-w-[800px]"><p className="att-empty">Computing attention snapshot...</p></div>;
  }

  if (!snapshot || snapshot.sources.length === 0) {
    return (
      <div className="max-w-[800px]">
        <p className="att-empty">No attention data yet. Consume some items first.</p>
      </div>
    );
  }

  const hasActivity = snapshot.total_score > 0;

  return (
    <div className="max-w-[800px]">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-semibold m-0">Attention Mirror</h2>
        <button className="sources-btn" onClick={fetch_}>Refresh</button>
      </div>
      <p className="text-[13px] text-[var(--ag-text-2)] mb-5">
        Comparing your intended attention allocation vs actual behavior.
      </p>

      {!hasActivity && (
        <div className="att-notice">
          No consumption activity recorded yet. Read some items or start conversations to see your attention pattern.
        </div>
      )}

      {/* Bar comparison */}
      <div className="att-bars">
        {snapshot.sources.map((src) => {
          const dev = deviationLabel(src.deviation);
          return (
            <div key={src.source_id} className="att-row">
              <div className="att-source-name">{src.source_name}</div>
              <div className="att-bar-pair">
                <div className="att-bar-group">
                  <div className="att-bar-label">Expected</div>
                  <div className="att-bar-track">
                    <div
                      className="att-bar expected"
                      style={{ width: `${Math.max(src.expected_weight * 100, 2)}%` }}
                    />
                  </div>
                  <span className="att-bar-value">{pct(src.expected_weight)}</span>
                </div>
                <div className="att-bar-group">
                  <div className="att-bar-label">Actual</div>
                  <div className="att-bar-track">
                    <div
                      className={`att-bar actual ${dev.cls}`}
                      style={{ width: `${Math.max(src.actual_weight * 100, 2)}%` }}
                    />
                  </div>
                  <span className="att-bar-value">{hasActivity ? pct(src.actual_weight) : '—'}</span>
                </div>
              </div>
              <div className={`att-deviation ${dev.cls}`}>{hasActivity ? dev.text : '—'}</div>
            </div>
          );
        })}
      </div>

      {/* Detail table */}
      {hasActivity && (
        <div className="att-detail">
          <h3>Signal Breakdown</h3>
          <table className="att-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Items</th>
                <th>Consumed</th>
                <th>Watching</th>
                <th>Discussed</th>
                <th>Dismissed</th>
                <th>Chat Rounds</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.sources.map((src) => (
                <tr key={src.source_id}>
                  <td>{src.source_name}</td>
                  <td>{src.detail.total_items}</td>
                  <td>{src.detail.consumed}</td>
                  <td>{src.detail.watching}</td>
                  <td>{src.detail.discussed}</td>
                  <td>{src.detail.dismissed}</td>
                  <td>{src.detail.chat_rounds}</td>
                  <td className="att-score">{src.raw_score}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="att-formula">
            Score = consumed×{snapshot.weights_config.consumed} + watching×{snapshot.weights_config.watching} + chat_rounds×{snapshot.weights_config.chatRound}
          </p>
        </div>
      )}

      <div className="att-timestamp">
        Computed at {new Date(snapshot.computed_at).toLocaleString()}
      </div>
    </div>
  );
}
