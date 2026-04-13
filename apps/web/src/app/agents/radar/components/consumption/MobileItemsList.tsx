'use client';

import { useCallback } from 'react';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import type { ItemWithState } from '@/lib/types';
import type { GradeFilter } from './ItemsList';
import { cn } from '@/lib/utils';

interface MobileItemsListProps {
  items: ItemWithState[];
  filter: GradeFilter;
  onFilterChange: (f: GradeFilter) => void;
  onSelect: (item: ItemWithState) => void;
  onSwipeAction?: (itemId: string, action: 'watching' | 'dismissed') => void;
  pendingMap: Record<string, string>;
}

const GRADE_ICON: Record<string, string> = {
  fire: '🔥',
  bolt: '⚡',
  bulb: '💡',
};

const SWIPE_THRESHOLD = 100; // px to trigger action

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function SwipeableCard({
  item,
  pending,
  onSelect,
  onSwipeAction,
}: {
  item: ItemWithState;
  pending?: string;
  onSelect: () => void;
  onSwipeAction?: (action: 'watching' | 'dismissed') => void;
}) {
  const handleDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      if (info.offset.x > SWIPE_THRESHOLD) {
        onSwipeAction?.('watching');
      } else if (info.offset.x < -SWIPE_THRESHOLD) {
        onSwipeAction?.('dismissed');
      }
    },
    [onSwipeAction],
  );

  return (
    <motion.div
      layout
      initial={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0, marginBottom: 0, overflow: 'hidden' }}
      transition={{ duration: 0.25 }}
      className="relative"
    >
      {/* Background hints */}
      <div className="absolute inset-0 flex items-center justify-between px-5 rounded-xl pointer-events-none">
        <span className="text-[13px] font-semibold opacity-60 text-[#16a34a]">👁 Watch</span>
        <span className="text-[13px] font-semibold opacity-60 text-[#dc2626]">✕ Dismiss</span>
      </div>

      {/* Draggable card */}
      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.6}
        onDragEnd={handleDragEnd}
        whileDrag={{ scale: 0.98 }}
        className={cn(
          'border border-[var(--ag-border)] rounded-xl py-3.5 px-4 cursor-pointer [-webkit-tap-highlight-color:transparent] transition-[background] duration-150',
          'active:bg-[var(--ag-hover)]',
          pending && 'opacity-60',
        )}
        data-card-id={item.id}
        onClick={onSelect}
        style={{ touchAction: 'pan-y' }}
      >
        <div className="flex items-center gap-1.5 mb-1.5 text-xs">
          <span className="text-sm">{GRADE_ICON[item.grade] ?? '•'}</span>
          <span className="text-[var(--ag-text-2)]">{item.source ?? item.agent_id}</span>
          <span className="ml-auto text-[var(--ag-text-2)]">{relativeTime(item.created_at)}</span>
        </div>
        <div className="text-[15px] font-semibold leading-[1.4] mb-1">{item.title}</div>
        {item.summary && (
          <div className="text-[13px] text-[var(--ag-text-2)] leading-[1.5] line-clamp-2">{item.summary.slice(0, 120)}</div>
        )}
        {pending && <div className="text-[11px] text-[var(--clr-bolt,#d97706)] mt-1">{pending}</div>}
      </motion.div>
    </motion.div>
  );
}

export default function MobileItemsList({
  items,
  filter,
  onFilterChange,
  onSelect,
  onSwipeAction,
  pendingMap,
}: MobileItemsListProps) {
  const filters: GradeFilter[] = ['all', 'fire', 'bolt', 'bulb'];

  return (
    <div className="p-2">
      {/* Filter chips */}
      <div className="flex gap-1.5 py-2 px-1 pb-3 overflow-x-auto">
        {filters.map((f) => (
          <button
            key={f}
            className={cn(
              'py-1.5 px-3.5 rounded-[20px] border border-[var(--ag-border)] bg-transparent text-[var(--ag-text-2)] text-[13px] whitespace-nowrap cursor-pointer [-webkit-tap-highlight-color:transparent]',
              filter === f && 'bg-[var(--ag-text)] text-[var(--ag-bg)] border-transparent',
            )}
            onClick={() => onFilterChange(f)}
          >
            {f === 'all' ? 'All' : GRADE_ICON[f]}
          </button>
        ))}
      </div>

      {/* Item cards */}
      <div className="flex flex-col gap-2">
        {items.length === 0 && (
          <div className="py-10 px-4 text-center text-[var(--ag-text-2)] text-sm">当前视图暂无内容</div>
        )}
        <AnimatePresence mode="popLayout">
          {items.map((item) => (
            <SwipeableCard
              key={item.id}
              item={item}
              pending={pendingMap[item.id]}
              onSelect={() => onSelect(item)}
              onSwipeAction={
                onSwipeAction
                  ? (action) => onSwipeAction(item.id, action)
                  : undefined
              }
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
