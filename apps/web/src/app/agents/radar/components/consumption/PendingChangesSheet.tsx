'use client';

/**
 * Mobile 底部 Pending 抽屉（Step 4）。
 *
 * 功能对齐 Desktop 的 PendingChangesBanner：
 * - pending 非空时显示
 * - 聚合 watching / dismissed / discussed 数量
 * - Apply / Discard 按钮
 * - 位于 TabBar 之上（Thumb-First 原则：主动作落在 EASY 区）
 *
 * Step 5 可替换为 Vaul Drawer（snap points + 详细列表），当前保留轻量条带。
 */

import { motion, AnimatePresence } from 'framer-motion';
import { Check, X } from 'lucide-react';
import type { ItemStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

interface PendingChangesSheetProps {
  pending: Record<string, ItemStatus>;
  busy: boolean;
  onApply: () => void;
  onDiscard: () => void;
}

export default function PendingChangesSheet({
  pending,
  busy,
  onApply,
  onDiscard,
}: PendingChangesSheetProps) {
  const keys = Object.keys(pending);
  const total = keys.length;

  return (
    <AnimatePresence>
      {total > 0 && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
          className={cn(
            'flex items-center gap-2.5 px-3 py-2.5',
            'border-t border-[var(--border)] bg-[var(--surface-hi)]',
            'shrink-0',
          )}
        >
          <span className="text-[13px] font-semibold text-[var(--text)] tracking-wide">
            {total} pending
          </span>
          <PendingCounts pending={pending} />

          <div className="flex-1" />

          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-1 py-1.5 px-3 rounded-full',
              'text-[12.5px] font-medium',
              'bg-transparent text-[var(--text-2)] border border-[var(--border)]',
              'cursor-pointer [-webkit-tap-highlight-color:transparent]',
              'active:bg-[var(--surface)] disabled:opacity-40',
            )}
            onClick={onDiscard}
            disabled={busy}
          >
            <X size={14} strokeWidth={2.2} />
            Discard
          </button>

          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-1 py-1.5 px-3.5 rounded-full',
              'text-[12.5px] font-semibold',
              'bg-[var(--text)] text-[var(--surface)] border border-transparent',
              'cursor-pointer [-webkit-tap-highlight-color:transparent]',
              'active:scale-[0.97] transition-transform disabled:opacity-40',
            )}
            onClick={onApply}
            disabled={busy}
          >
            <Check size={14} strokeWidth={2.4} />
            {busy ? 'Applying…' : `Apply ${total}`}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PendingCounts({ pending }: { pending: Record<string, ItemStatus> }) {
  const counts: Record<string, number> = {};
  for (const k of Object.keys(pending)) {
    const v = pending[k];
    counts[v] = (counts[v] ?? 0) + 1;
  }
  return (
    <span className="text-[11.5px] text-[var(--text-2)] tracking-wide">
      {Object.entries(counts)
        .map(([k, v]) => `${v} ${k}`)
        .join(' · ')}
    </span>
  );
}
