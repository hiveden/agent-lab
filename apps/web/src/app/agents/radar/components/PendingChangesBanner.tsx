'use client';

import type { ItemStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

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
      <button
        className="py-[3px] px-2.5 text-[11.5px] rounded border border-[#f3dca8] bg-white text-[var(--warn)] cursor-pointer transition-all duration-[.12s] hover:brightness-95"
        onClick={onDiscard}
        disabled={busy}
      >
        Discard
      </button>
      <button
        className={cn(
          'py-[3px] px-2.5 text-[11.5px] rounded border cursor-pointer transition-all duration-[.12s] hover:brightness-95',
          'bg-[var(--warn)] text-white border-[var(--warn)]',
        )}
        onClick={onApply}
        disabled={busy}
      >
        {busy ? 'Applying…' : 'Apply'}
      </button>
    </div>
  );
}
