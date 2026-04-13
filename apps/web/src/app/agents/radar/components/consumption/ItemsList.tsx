'use client';

import { useEffect, useRef } from 'react';
import type { ItemWithState, ItemStatus } from '@/lib/types';

export type GradeFilter = 'all' | 'fire' | 'bolt' | 'bulb';

function relTime(iso: string): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60_000) return 'now';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d`;
  const w = Math.floor(d / 7);
  return `${w}w`;
}

interface Props {
  items: ItemWithState[];
  filter: GradeFilter;
  onFilterChange: (f: GradeFilter) => void;
  selectedId: string | null;
  focusedIndex: number;
  onSelect: (idx: number) => void;
  pendingMap: Record<string, ItemStatus>;
  listWidth: number;
  onResize: (w: number) => void;
}

const chips: { f: GradeFilter; label: string }[] = [
  { f: 'all', label: 'all' },
  { f: 'fire', label: 'fire' },
  { f: 'bolt', label: 'bolt' },
  { f: 'bulb', label: 'bulb' },
];

export default function ItemsList({
  items,
  filter,
  onFilterChange,
  selectedId,
  focusedIndex,
  onSelect,
  pendingMap,
  listWidth,
  onResize,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll the focused row into view
  useEffect(() => {
    const el = scrollRef.current?.querySelector(
      `[data-idx="${focusedIndex}"]`,
    ) as HTMLElement | null;
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [focusedIndex]);

  // Drag divider
  const draggingRef = useRef(false);
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!draggingRef.current) return;
      const main = document.querySelector('.main') as HTMLElement | null;
      if (!main) return;
      const m = main.getBoundingClientRect();
      let w = e.clientX - m.left - 52;
      const min = 260;
      const max = m.width * 0.55;
      if (w < min) w = min;
      if (w > max) w = max;
      onResize(w);
    }
    function onUp() {
      if (draggingRef.current) {
        draggingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document
          .querySelector('.col-divider')
          ?.classList.remove('dragging');
      }
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [onResize]);

  return (
    <section
      className="list-col"
      style={{ ['--list-w' as string]: `${listWidth}px` }}
    >
      <div className="list-head">
        <h1>Radar</h1>
        <span className="count">{items.length}</span>
      </div>
      <div className="list-filters">
        <span className="label">grade</span>
        {chips.map((c) => (
          <button
            key={c.f}
            className={`fchip ${filter === c.f ? 'active' : ''}`}
            onClick={() => onFilterChange(c.f)}
          >
            <span className={`dot ${c.f}`} />
            {c.label}
          </button>
        ))}
      </div>
      <div className="list-scroll" ref={scrollRef}>
        {items.length === 0 ? (
          <div
            style={{
              padding: 24,
              textAlign: 'center',
              color: 'var(--text-3)',
              fontSize: 12,
            }}
          >
            No items.
          </div>
        ) : (
          items.map((it, idx) => {
            const isSelected = it.id === selectedId;
            const isFocused = idx === focusedIndex;
            const pending = it.id in pendingMap;
            return (
              <div
                key={it.id}
                data-idx={idx}
                className={`item-row ${isSelected ? 'selected' : ''} ${
                  isFocused ? 'focused' : ''
                } ${pending ? 'pending' : ''}`}
                onClick={() => onSelect(idx)}
              >
                <span className={`item-grade ${it.grade}`} />
                <div className="item-main">
                  <div className="item-title">{it.title}</div>
                  <div className="item-sub">
                    {it.source ? (
                      <span className="src">{it.source}</span>
                    ) : null}
                    <span className="sep">·</span>
                    <span className="snip">{it.summary}</span>
                  </div>
                </div>
                <span className="item-time">{relTime(it.round_at)}</span>
              </div>
            );
          })
        )}
      </div>
      <div
        className="col-divider"
        onMouseDown={(e) => {
          draggingRef.current = true;
          (e.currentTarget as HTMLElement).classList.add('dragging');
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
          e.preventDefault();
        }}
      />
    </section>
  );
}
