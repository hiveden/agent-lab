'use client';

export interface FunnelData {
  fetched: number;
  promoted: number;
  rejected: number;
  pending?: number;
}

export interface FunnelViewProps {
  data: FunnelData;
  phase?: string;
}

export default function FunnelView({ data, phase }: FunnelViewProps) {
  const max = Math.max(data.fetched, 1);

  return (
    <div className="funnel-view">
      <div className="funnel-title">{phase === 'evaluate' ? 'Evaluate Funnel' : 'Ingest Funnel'}</div>
      <div className="funnel-steps">
        <div className="funnel-step">
          <div className="funnel-bar" style={{ width: '100%' }}>
            <span className="funnel-label">Fetched</span>
            <span className="funnel-count">{data.fetched}</span>
          </div>
        </div>
        {data.promoted !== undefined && (
          <div className="funnel-step">
            <div
              className="funnel-bar promoted"
              style={{ width: `${Math.max((data.promoted / max) * 100, 8)}%` }}
            >
              <span className="funnel-label">Promoted</span>
              <span className="funnel-count">{data.promoted}</span>
            </div>
          </div>
        )}
        {data.rejected !== undefined && (
          <div className="funnel-step">
            <div
              className="funnel-bar rejected"
              style={{ width: `${Math.max((data.rejected / max) * 100, 8)}%` }}
            >
              <span className="funnel-label">Rejected</span>
              <span className="funnel-count">{data.rejected}</span>
            </div>
          </div>
        )}
        {data.pending !== undefined && data.pending > 0 && (
          <div className="funnel-step">
            <div
              className="funnel-bar pending"
              style={{ width: `${Math.max((data.pending / max) * 100, 8)}%` }}
            >
              <span className="funnel-label">Pending</span>
              <span className="funnel-count">{data.pending}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
