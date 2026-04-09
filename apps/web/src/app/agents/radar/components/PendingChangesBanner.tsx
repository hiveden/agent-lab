'use client';

import type { ItemStatus } from '@/lib/types';

interface Props {
  pending: Record<string, ItemStatus>;
  onApply: () => void;
  onDiscard: () => void;
  busy: boolean;
}

export default function PendingChangesBanner({
  pending,
  onApply,
  onDiscard,
  busy,
}: Props) {
  const keys = Object.keys(pending);
  if (keys.length === 0) return null;
  const counts: Record<string, number> = {};
  for (const k of keys) {
    const v = pending[k];
    counts[v] = (counts[v] ?? 0) + 1;
  }
  const parts = Object.entries(counts)
    .map(([k, v]) => `${v} ${k}`)
    .join(', ');
  return (
    <div className="pending-banner">
      <span className="count">{keys.length} pending change{keys.length > 1 ? 's' : ''}</span>
      <span>: {parts}</span>
      <span className="spacer" />
      <button className="bbtn" onClick={onDiscard} disabled={busy}>
        Discard
      </button>
      <button className="bbtn primary" onClick={onApply} disabled={busy}>
        {busy ? 'Applying…' : 'Apply'}
      </button>
    </div>
  );
}
