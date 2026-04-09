'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ItemWithState } from '@/lib/types';

export interface PaletteAction {
  id: string;
  label: string;
  hint: string;
  run: () => void;
  enabled?: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  items: ItemWithState[];
  actions: PaletteAction[];
  onPickItem: (it: ItemWithState) => void;
}

export default function CommandPalette({
  open,
  onClose,
  items,
  actions,
  onPickItem,
}: Props) {
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setFocused(0);
      // Focus next tick so the overlay is mounted first
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const filteredItems = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const base = qq
      ? items.filter(
          (it) =>
            it.title.toLowerCase().includes(qq) ||
            (it.summary ?? '').toLowerCase().includes(qq),
        )
      : items;
    return base.slice(0, 8);
  }, [q, items]);

  const filteredActions = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return actions
      .filter((a) => a.enabled !== false)
      .filter((a) => !qq || a.label.toLowerCase().includes(qq));
  }, [q, actions]);

  const flat = useMemo(
    () => [
      ...filteredItems.map((it) => ({ type: 'item' as const, item: it })),
      ...filteredActions.map((a) => ({ type: 'action' as const, action: a })),
    ],
    [filteredItems, filteredActions],
  );

  useEffect(() => {
    if (focused >= flat.length) setFocused(0);
  }, [flat.length, focused]);

  if (!open) return null;

  function executeFocused() {
    const r = flat[focused];
    if (!r) return;
    onClose();
    if (r.type === 'item') onPickItem(r.item);
    else r.action.run();
  }

  return (
    <div
      className="cmdk-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cmdk" role="dialog" aria-label="Command palette">
        <div className="cmdk-input-row">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder="Search items, run actions, navigate…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setFocused(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setFocused((f) => (flat.length ? (f + 1) % flat.length : 0));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setFocused((f) =>
                  flat.length ? (f - 1 + flat.length) % flat.length : 0,
                );
              } else if (e.key === 'Enter') {
                e.preventDefault();
                executeFocused();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
          />
          <span className="cmdk-hint-esc">esc</span>
        </div>
        <div className="cmdk-list">
          {filteredItems.length > 0 ? (
            <>
              <div className="cmdk-group">Resources</div>
              {filteredItems.map((it, i) => (
                <div
                  key={it.id}
                  className={`cmdk-item ${focused === i ? 'focused' : ''}`}
                  onMouseEnter={() => setFocused(i)}
                  onClick={() => {
                    onClose();
                    onPickItem(it);
                  }}
                >
                  <span className={`grade-dot ${it.grade}`} />
                  <span className="label">{it.title}</span>
                  <span className="hint">{it.source ?? ''}</span>
                </div>
              ))}
            </>
          ) : null}
          {filteredActions.length > 0 ? (
            <>
              <div className="cmdk-group">Actions</div>
              {filteredActions.map((a, i) => {
                const idx = filteredItems.length + i;
                return (
                  <div
                    key={a.id}
                    className={`cmdk-item ${focused === idx ? 'focused' : ''}`}
                    onMouseEnter={() => setFocused(idx)}
                    onClick={() => {
                      onClose();
                      a.run();
                    }}
                  >
                    <span className="grade-dot" style={{ background: 'var(--text-faint)' }} />
                    <span className="label">{a.label}</span>
                    <span className="hint">{a.hint}</span>
                  </div>
                );
              })}
            </>
          ) : null}
          {flat.length === 0 ? (
            <div
              style={{
                padding: 30,
                textAlign: 'center',
                color: 'var(--text-3)',
                fontSize: 12.5,
              }}
            >
              No results for &quot;{q}&quot;
            </div>
          ) : null}
        </div>
        <div className="cmdk-footer">
          <span>
            <kbd className="k">↑</kbd>
            <kbd className="k">↓</kbd> navigate
          </span>
          <span>
            <kbd className="k">↵</kbd> select
          </span>
          <span>
            <kbd className="k">esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
