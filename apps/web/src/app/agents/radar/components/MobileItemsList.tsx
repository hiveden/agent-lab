'use client';

import { useCallback } from 'react';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import type { ItemWithState } from '@/lib/types';
import type { GradeFilter } from './ItemsList';

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
      className="m-swipe-wrapper"
    >
      {/* Background hints */}
      <div className="m-swipe-bg">
        <span className="m-swipe-hint left">👁 Watch</span>
        <span className="m-swipe-hint right">✕ Dismiss</span>
      </div>

      {/* Draggable card */}
      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.6}
        onDragEnd={handleDragEnd}
        whileDrag={{ scale: 0.98 }}
        className={`m-card ${pending ? 'pending' : ''}`}
        onClick={onSelect}
        style={{ touchAction: 'pan-y' }}
      >
        <div className="m-card-top">
          <span className="m-grade">{GRADE_ICON[item.grade] ?? '•'}</span>
          <span className="m-source">{item.source ?? item.agent_id}</span>
          <span className="m-time">{relativeTime(item.created_at)}</span>
        </div>
        <div className="m-card-title">{item.title}</div>
        {item.summary && (
          <div className="m-card-summary">{item.summary.slice(0, 120)}</div>
        )}
        {pending && <div className="m-card-pending">{pending}</div>}
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
    <div className="m-items">
      {/* Filter chips */}
      <div className="m-filters">
        {filters.map((f) => (
          <button
            key={f}
            className={`m-filter-chip ${filter === f ? 'active' : ''}`}
            onClick={() => onFilterChange(f)}
          >
            {f === 'all' ? 'All' : GRADE_ICON[f]}
          </button>
        ))}
      </div>

      {/* Item cards */}
      <div className="m-cards">
        {items.length === 0 && (
          <div className="m-empty">No items in this view.</div>
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
