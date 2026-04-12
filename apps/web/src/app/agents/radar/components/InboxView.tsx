'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useRadarStore } from '@/lib/stores/radar-store';
import type { ViewType } from './NavRail';
import ChatView from './ChatView';
import TraceDrawer from './TraceDrawer';
import { cn } from '@/lib/utils';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';

type CategoryTab = 'inbox' | 'watching' | 'archive';

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

const gradeChips = [
  { f: 'all' as const, label: 'All' },
  { f: 'fire' as const, label: '' },
  { f: 'bolt' as const, label: '' },
  { f: 'bulb' as const, label: '' },
];

const tabs: { key: CategoryTab; label: string }[] = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'watching', label: 'Watching' },
  { key: 'archive', label: 'Archive' },
];

export default function InboxView() {
  // ── Store selectors ────────────────────────────────────────
  const items = useRadarStore((s) => s.items);
  const activeView = useRadarStore((s) => s.activeView);
  const filter = useRadarStore((s) => s.filter);
  const selectedId = useRadarStore((s) => s.selectedId);
  const pending = useRadarStore((s) => s.pending);
  const sessions = useRadarStore((s) => s.sessions);
  const traceOpen = useRadarStore((s) => s.traceOpen);
  const activeTrace = useRadarStore((s) => s.activeTrace);
  const highlightSpanId = useRadarStore((s) => s.highlightSpanId);
  const expandAllSignal = useRadarStore((s) => s.expandAllSignal);
  const collapseAllSignal = useRadarStore((s) => s.collapseAllSignal);

  // ── Store actions ──────────────────────────────────────────
  const setFilter = useRadarStore((s) => s.setFilter);
  const setSelectedId = useRadarStore((s) => s.setSelectedId);
  const setFocusedIndex = useRadarStore((s) => s.setFocusedIndex);
  const handleViewChange = useRadarStore((s) => s.handleViewChange);
  const markPending = useRadarStore((s) => s.markPending);
  const setTraceOpen = useRadarStore((s) => s.setTraceOpen);
  const setActiveTrace = useRadarStore((s) => s.setActiveTrace);
  const setHighlightSpanId = useRadarStore((s) => s.setHighlightSpanId);
  const updateSession = useRadarStore((s) => s.updateSession);

  // ── Derived state ──────────────────────────────────────────
  const activeTab: CategoryTab =
    activeView === 'watching' ? 'watching' : activeView === 'archive' ? 'archive' : 'inbox';

  const filteredItems = useMemo(() => {
    const withStatus = items.map((it) => ({
      ...it,
      status: pending[it.id] ?? it.status,
    }));
    if (filter === 'all') return withStatus;
    return withStatus.filter((it) => it.grade === filter);
  }, [items, filter, pending]);

  const selectedItem = useMemo(
    () => items.find((it) => it.id === selectedId) ?? null,
    [items, selectedId],
  );

  const currentSession = selectedId ? sessions[selectedId] ?? null : null;

  const tabCounts = useMemo(
    () => ({
      inbox: activeTab === 'inbox' ? items.length : 0,
      watching: activeTab === 'watching' ? items.length : 0,
      archive: activeTab === 'archive' ? items.length : 0,
    }),
    [activeTab, items.length],
  );

  // ── Callbacks ──────────────────────────────────────────────
  const handleTabChange = useCallback(
    (tab: CategoryTab) => handleViewChange(tab as ViewType),
    [handleViewChange],
  );

  const handleSelectById = useCallback(
    (id: string) => {
      const idx = filteredItems.findIndex((it) => it.id === id);
      if (idx >= 0) {
        setFocusedIndex(idx);
        setSelectedId(id);
        setActiveTrace(null);
        setHighlightSpanId(null);
      }
    },
    [filteredItems, setFocusedIndex, setSelectedId, setActiveTrace, setHighlightSpanId],
  );

  const handleChatUpdate = useCallback(
    (msgs: import('ai').Message[]) => {
      if (selectedId) updateSession(selectedId, msgs);
    },
    [selectedId, updateSession],
  );

  const handleOpenFromSpan = useCallback(
    (trace: import('../traceMock').MockTrace, spanId: string | null) => {
      setActiveTrace(trace);
      setHighlightSpanId(spanId);
      setTraceOpen(true);
    },
    [setActiveTrace, setHighlightSpanId, setTraceOpen],
  );

  const gridRef = useRef<HTMLDivElement>(null);

  // Scroll selected card into view
  useEffect(() => {
    if (!selectedId || !gridRef.current) return;
    const el = gridRef.current.querySelector(`[data-id="${selectedId}"]`) as HTMLElement | null;
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  // ── Render ─────────────────────────────────────────────────
  const showBottom = !!(selectedItem && currentSession !== undefined);

  return (
    <div className="flex flex-col min-h-0 overflow-hidden">
      {/* Category tabs + grade filter */}
      <div className="flex items-center px-4 border-b border-[var(--border)] shrink-0">
        <Tabs value={activeTab} onValueChange={(v) => handleTabChange(v as CategoryTab)}>
          <TabsList>
            {tabs.map((t) => (
              <TabsTrigger key={t.key} value={t.key}>
                {t.label}
                <span className="text-[11px] text-muted-foreground ml-1">{tabCounts[t.key]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="ml-auto flex gap-1">
          {gradeChips.map((c) => (
            <Badge
              key={c.f}
              variant="outline"
              className={cn(
                'cursor-pointer text-[11px] py-[3px] px-2.5 rounded-[14px] gap-[3px]',
                filter === c.f
                  ? 'bg-[var(--accent)] text-white border-transparent'
                  : 'bg-transparent text-[var(--text-2)] border-[var(--border)]',
              )}
              onClick={() => {
                setFilter(c.f);
                setFocusedIndex(0);
              }}
            >
              {c.f !== 'all' && <span className={cn('grade-dot', c.f)} />}
              {c.label || c.f}
            </Badge>
          ))}
        </div>
      </div>

      {/* Vertical Group: cards (top) ↔ chat+trace (bottom) */}
      <Group orientation="vertical" className="flex-1 min-h-0">
        <Panel minSize={20}>
          <div className="h-full overflow-hidden flex flex-col">
            <div className="flex-1 overflow-y-auto p-4" ref={gridRef}>
              {filteredItems.length === 0 ? (
                <div className="p-6 text-center text-[var(--text-3)] text-xs">No items.</div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(380px,1fr))] gap-3">
                  {filteredItems.map((it) => {
                    const isSelected = it.id === selectedId;
                    const isPending = it.id in pending;
                    return (
                      <div
                        key={it.id}
                        data-id={it.id}
                        className={cn(
                          'border border-[var(--border)] rounded-[var(--radius,10px)] p-4 bg-[var(--surface)] cursor-pointer transition-shadow duration-150',
                          'hover:shadow-[0_2px_8px_rgba(0,0,0,.06)]',
                          isSelected && 'border-[var(--accent)] shadow-[0_0_0_1px_var(--accent)]',
                          isPending && 'opacity-70',
                        )}
                        onClick={() => handleSelectById(it.id)}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline" className={cn(
                            'text-[10px] px-1.5 py-0 h-5',
                            it.grade === 'fire' && 'border-[var(--fire)] text-[var(--fire)] bg-[var(--fire-bg,var(--fire-soft))]',
                            it.grade === 'bolt' && 'border-[var(--bolt)] text-[var(--bolt)] bg-[var(--bolt-bg,var(--bolt-soft))]',
                            it.grade === 'bulb' && 'border-[var(--bulb)] text-[var(--bulb)] bg-[var(--bulb-bg,var(--bulb-soft))]',
                          )}>
                            {it.grade}
                          </Badge>
                          <span className="text-[11px] text-[var(--text-2)]">{it.source ?? ''}</span>
                          <span className="text-[11px] text-[var(--text-3)] ml-auto">{relTime(it.round_at)}</span>
                        </div>
                        <div className="font-semibold text-[15px] leading-[1.5] mb-1.5">{it.title}</div>
                        <div className="text-[13px] text-[var(--text-2)] leading-[1.6] mb-2">{it.summary}</div>
                        {it.why ? (
                          <div className="text-xs text-[var(--bolt)] leading-[1.5] p-2 px-2.5 bg-[var(--bolt-bg)] rounded-[var(--radius-sm,6px)] mb-2.5">
                            {it.why}
                          </div>
                        ) : null}
                        <div className="flex items-center gap-2.5 text-[11px] text-[var(--text-3)]">
                          {it.url ? (
                            <a
                              href={it.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[var(--text-2)] no-underline hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              View original
                            </a>
                          ) : null}
                          <div className="ml-auto flex gap-1">
                            <button
                              className={cn(
                                'item-action',
                                pending[it.id] === 'watching' && 'active',
                              )}
                              title="Watch"
                              onClick={(e) => {
                                e.stopPropagation();
                                markPending(it.id, 'watching');
                              }}
                            >
                              W
                            </button>
                            <button
                              className={cn(
                                'item-action',
                                pending[it.id] === 'dismissed' && 'active',
                              )}
                              title="Dismiss"
                              onClick={(e) => {
                                e.stopPropagation();
                                markPending(it.id, 'dismissed');
                              }}
                            >
                              D
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </Panel>

        {showBottom && (
          <>
            <Separator className="drag-handle">
              <div className="drag-bar" />
            </Separator>
            <Panel defaultSize={30} minSize={15}>
              <Group orientation="horizontal" className="border-t border-[var(--border)] flex overflow-hidden min-h-0 h-full">
                <Panel minSize={30}>
                  <ChatView
                    key={selectedItem.id}
                    item={selectedItem}
                    initialMessages={currentSession?.messages ?? []}
                    sessionId={currentSession?.session_id ?? null}
                    onOpenTraceFromSpan={handleOpenFromSpan}
                    onToggleTrace={() => setTraceOpen(!traceOpen)}
                    traceOpen={traceOpen}
                    onChatUpdate={handleChatUpdate}
                  />
                </Panel>
                {traceOpen && (
                  <>
                    <Separator className="trace-divider" />
                    <Panel defaultSize={40} minSize={20} maxSize={60}>
                      <TraceDrawer
                        open={traceOpen}
                        trace={activeTrace}
                        onClose={() => setTraceOpen(false)}
                        highlightSpanId={highlightSpanId}
                        expandAllSignal={expandAllSignal}
                        collapseAllSignal={collapseAllSignal}
                      />
                    </Panel>
                  </>
                )}
              </Group>
            </Panel>
          </>
        )}
      </Group>
    </div>
  );
}
