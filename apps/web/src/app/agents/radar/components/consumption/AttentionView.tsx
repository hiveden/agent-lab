'use client';

import { useCallback, useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';

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

      {/* Bar comparison chart */}
      <div className="att-chart" style={{ marginBottom: 28 }}>
        <ResponsiveContainer width="100%" height={Math.max(200, snapshot.sources.length * 60)}>
          <BarChart
            data={snapshot.sources.map((s) => ({
              name: s.source_name,
              expected: +(s.expected_weight * 100).toFixed(1),
              actual: hasActivity ? +(s.actual_weight * 100).toFixed(1) : 0,
            }))}
            layout="vertical"
            margin={{ left: 100, right: 20 }}
          >
            <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={90} />
            <Tooltip formatter={(v) => `${Number(v).toFixed(1)}%`} />
            <Legend />
            <Bar dataKey="expected" fill="var(--text-3)" name="Expected" radius={[0, 3, 3, 0]} />
            <Bar dataKey="actual" fill="var(--accent)" name="Actual" radius={[0, 3, 3, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Deviation labels */}
      <div className="att-deviations" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
        {snapshot.sources.map((src) => {
          const dev = deviationLabel(src.deviation);
          return (
            <div key={src.source_id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ fontWeight: 500 }}>{src.source_name}</span>
              <span className={`att-deviation ${dev.cls}`}>{hasActivity ? dev.text : '—'}</span>
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
