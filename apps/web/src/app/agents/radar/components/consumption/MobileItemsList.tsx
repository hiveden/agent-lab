'use client';

/**
 * Mobile Inbox 列表 — Step 7 加入虚拟滚动（@tanstack/react-virtual）。
 *
 * 关键决策（ADR-5）：
 * - Container scroll（非 window scroll）：规避 iOS #884 momentum 中断
 * - 去掉 AnimatePresence exit：与虚拟滚动 unmount 语义冲突
 * - 不用 framer-motion `layout` 动画：与 ResizeObserver 冲突
 * - 保留 SwipeableCard 的 drag（transform 不影响 ResizeObserver 高度测量）
 * - 视觉反馈：pending 态通过卡片 opacity 0.6 体现（Step 4 已实现）
 *
 * Filter chips sticky top，与虚拟滚动容器共用 scroll。
 */

import { useCallback, useRef } from 'react';
import {
  motion,
  useMotionValue,
  useTransform,
  type PanInfo,
} from 'framer-motion';
import { useVirtualizer } from '@tanstack/react-virtual';
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

const SWIPE_THRESHOLD = 96;
const ESTIMATED_CARD_HEIGHT = 120; // 首屏估算，measureElement 会在挂载后校准

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
  const watchOpacity = useTransform(x, [0, SWIPE_THRESHOLD * 0.3, SWIPE_THRESHOLD], [0, 0.5, 1]);
  const watchScale = useTransform(x, [0, SWIPE_THRESHOLD], [0.85, 1]);
  const dismissOpacity = useTransform(
    x,
    [-SWIPE_THRESHOLD, -SWIPE_THRESHOLD * 0.3, 0],
    [1, 0.5, 0],
  );
  const dismissScale = useTransform(x, [-SWIPE_THRESHOLD, 0], [1, 0.85]);
  const bgColor = useTransform(
    x,
    [-SWIPE_THRESHOLD, 0, SWIPE_THRESHOLD],
    ['rgba(220,38,38,0.18)', 'rgba(0,0,0,0)', 'rgba(22,163,74,0.18)'],
  );

  const handleDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      if (info.offset.x > SWIPE_THRESHOLD) onSwipeAction?.('watching');
      else if (info.offset.x < -SWIPE_THRESHOLD) onSwipeAction?.('dismissed');
    },
    [onSwipeAction],
  );

  return (
    <div className="relative">
      <motion.div
        className="absolute inset-0 rounded-2xl pointer-events-none"
        style={{ backgroundColor: bgColor }}
      />
      <motion.div
        className="absolute inset-y-0 left-5 flex items-center gap-1.5 pointer-events-none"
        style={{ opacity: watchOpacity, scale: watchScale }}
      >
        <Eye size={18} strokeWidth={2.2} className="text-[#16a34a]" />
        <span className="text-[13px] font-semibold text-[#16a34a] tracking-wide">Watch</span>
      </motion.div>
      <motion.div
        className="absolute inset-y-0 right-5 flex items-center gap-1.5 pointer-events-none"
        style={{ opacity: dismissOpacity, scale: dismissScale }}
      >
        <span className="text-[13px] font-semibold text-[#dc2626] tracking-wide">Dismiss</span>
        <X size={18} strokeWidth={2.2} className="text-[#dc2626]" />
      </motion.div>

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
          'active:bg-[var(--surface-hi)] transition-[background,opacity] duration-150',
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
    </div>
  );
}

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
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_CARD_HEIGHT,
    overscan: 5,
    getItemKey: (index) => items[index]?.id ?? index,
    // 行间距通过每行 paddingBottom 吸收，measureElement 可测真实高度
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto [-webkit-overflow-scrolling:touch] overscroll-contain"
    >
      {/* Filter chips — sticky top */}
      <div className="sticky top-0 z-10 flex gap-2 pt-2 pb-3 px-3 bg-[var(--surface)]">
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

      {/* Virtualized item list */}
      <div className="px-3 pb-[env(safe-area-inset-bottom,0)]">
        {items.length === 0 ? (
          <div className="py-14 px-4 text-center text-[var(--text-2)] text-[13px]">
            当前视图暂无内容
          </div>
        ) : (
          <div style={{ height: totalSize, position: 'relative', width: '100%' }}>
            {virtualRows.map((vRow) => {
              const item = items[vRow.index];
              if (!item) return null;
              return (
                <div
                  key={vRow.key}
                  ref={virtualizer.measureElement}
                  data-index={vRow.index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    transform: `translateY(${vRow.start}px)`,
                  }}
                  className="pb-2.5"
                >
                  <SwipeableCard
                    item={item}
                    pending={pendingMap[item.id]}
                    onSelect={() => onSelect(item)}
                    onSwipeAction={
                      onSwipeAction
                        ? (action) => onSwipeAction(item.id, action)
                        : undefined
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
