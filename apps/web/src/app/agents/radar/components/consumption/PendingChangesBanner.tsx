'use client';

import type { ItemStatus } from '@/lib/types';
import { Button } from '@/components/ui/button';

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
    <div className="flex items-center gap-3 py-[7px] px-[14px] bg-[#fff8ea] border-b border-[#f3dca8] text-[var(--warn)] text-xs shrink-0">
      <span className="font-semibold">{keys.length} pending change{keys.length > 1 ? 's' : ''}</span>
      <span>: {parts}</span>
      <span className="flex-1" />
      <Button size="sm" variant="ghost" onClick={onDiscard} disabled={busy}>
        Discard
      </Button>
      <Button size="sm" onClick={onApply} disabled={busy}>
        {busy ? 'Applying…' : `Apply ${keys.length} changes`}
      </Button>
    </div>
  );
}
