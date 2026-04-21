'use client';

import { useCallback } from 'react';
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useTransform,
  type PanInfo,
} from 'framer-motion';
import { Eye, X, Flame, Zap, Lightbulb } from 'lucide-react';
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

const SWIPE_THRESHOLD = 96; // px

/** Grade → Lucide Icon + 颜色 token（ADR-4 设计代币预演） */
function GradeIcon({ grade, size = 14 }: { grade: string; size?: number }) {
  const common = { size, strokeWidth: 2 } as const;
  if (grade === 'fire') return <Flame {...common} className="text-[#ea580c]" />;
  if (grade === 'bolt') return <Zap {...common} className="text-[#ca8a04]" />;
  if (grade === 'bulb') return <Lightbulb {...common} className="text-[#0284c7]" />;
  return null;
}

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
  const x = useMotionValue(0);

  // drag → hint opacity/scale 映射（静止时完全隐藏，阈值时饱和）
  const watchOpacity = useTransform(x, [0, SWIPE_THRESHOLD * 0.3, SWIPE_THRESHOLD], [0, 0.5, 1]);
  const watchScale = useTransform(x, [0, SWIPE_THRESHOLD], [0.85, 1]);
  const dismissOpacity = useTransform(
    x,
    [-SWIPE_THRESHOLD, -SWIPE_THRESHOLD * 0.3, 0],
    [1, 0.5, 0],
  );
  const dismissScale = useTransform(x, [-SWIPE_THRESHOLD, 0], [1, 0.85]);

  // 背景渐变色：左红 中透明 右绿
  const bgColor = useTransform(
    x,
    [-SWIPE_THRESHOLD, 0, SWIPE_THRESHOLD],
    ['rgba(220,38,38,0.18)', 'rgba(0,0,0,0)', 'rgba(22,163,74,0.18)'],
  );

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
      transition={{ duration: 0.22 }}
      className="relative"
    >
      {/* 背景渐变层（随 drag 进度显色） */}
      <motion.div
        className="absolute inset-0 rounded-2xl pointer-events-none"
        style={{ backgroundColor: bgColor }}
      />

      {/* Watch hint（右滑时从左侧浮出） */}
      <motion.div
        className="absolute inset-y-0 left-5 flex items-center gap-1.5 pointer-events-none"
        style={{ opacity: watchOpacity, scale: watchScale }}
      >
        <Eye size={18} strokeWidth={2.2} className="text-[#16a34a]" />
        <span className="text-[13px] font-semibold text-[#16a34a] tracking-wide">
          Watch
        </span>
      </motion.div>

      {/* Dismiss hint（左滑时从右侧浮出） */}
      <motion.div
        className="absolute inset-y-0 right-5 flex items-center gap-1.5 pointer-events-none"
        style={{ opacity: dismissOpacity, scale: dismissScale }}
      >
        <span className="text-[13px] font-semibold text-[#dc2626] tracking-wide">
          Dismiss
        </span>
        <X size={18} strokeWidth={2.2} className="text-[#dc2626]" />
      </motion.div>

      {/* Draggable card */}
      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.55}
        onDragEnd={handleDragEnd}
        whileDrag={{ scale: 0.985 }}
        style={{ x, touchAction: 'pan-y' }}
        className={cn(
          'relative bg-[var(--surface)] border border-[var(--border)] rounded-2xl',
          'py-3.5 px-4 cursor-pointer [-webkit-tap-highlight-color:transparent]',
          'active:bg-[var(--surface-hi)] transition-[background] duration-150',
          pending && 'opacity-60',
        )}
        data-card-id={item.id}
        onClick={onSelect}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <GradeIcon grade={item.grade} />
          <span className="text-[11.5px] text-[var(--text-2)] tracking-wide">
            {item.source ?? item.agent_id}
          </span>
          <span className="ml-auto text-[11.5px] text-[var(--text-2)] tabular-nums">
            {relativeTime(item.created_at)}
          </span>
        </div>
        <div className="text-[15.5px] font-semibold leading-[1.4] mb-1 text-[var(--text)]">
          {item.title}
        </div>
        {item.summary && (
          <div className="text-[13px] text-[var(--text-2)] leading-[1.55] line-clamp-2">
            {item.summary}
          </div>
        )}
        {pending && (
          <div className="mt-1.5 inline-flex items-center gap-1 text-[10.5px] font-medium uppercase tracking-wider text-[var(--clr-bolt,#d97706)]">
            pending · {pending}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

/** Filter chip — 紧凑 pill，无 emoji */
function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center gap-1.5 py-[7px] px-3.5 rounded-full',
        'text-[12.5px] font-medium whitespace-nowrap',
        'cursor-pointer [-webkit-tap-highlight-color:transparent]',
        'transition-colors duration-150',
        active
          ? 'bg-[var(--text)] text-[var(--surface)] border border-transparent'
          : 'bg-transparent text-[var(--text-2)] border border-[var(--border)] hover:text-[var(--text)]',
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const FILTER_LABELS: Record<GradeFilter, { label: string; icon?: React.ReactNode }> = {
  all: { label: 'All' },
  fire: { label: 'Fire', icon: <Flame size={13} className="text-[#ea580c]" /> },
  bolt: { label: 'Bolt', icon: <Zap size={13} className="text-[#ca8a04]" /> },
  bulb: { label: 'Bulb', icon: <Lightbulb size={13} className="text-[#0284c7]" /> },
};

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
    <div className="px-3 pt-2">
      {/* Filter chips */}
      <div className="flex gap-2 pb-3 overflow-x-auto">
        {filters.map((f) => {
          const meta = FILTER_LABELS[f];
          return (
            <FilterChip key={f} active={filter === f} onClick={() => onFilterChange(f)}>
              {meta.icon}
              {meta.label}
            </FilterChip>
          );
        })}
      </div>

      {/* Item cards */}
      <div className="flex flex-col gap-2.5">
        {items.length === 0 && (
          <div className="py-14 px-4 text-center text-[var(--text-2)] text-[13px]">
            当前视图暂无内容
          </div>
        )}
        <AnimatePresence mode="popLayout">
          {items.map((item) => (
            <SwipeableCard
              key={item.id}
              item={item}
              pending={pendingMap[item.id]}
              onSelect={() => onSelect(item)}
              onSwipeAction={
                onSwipeAction ? (action) => onSwipeAction(item.id, action) : undefined
              }
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
