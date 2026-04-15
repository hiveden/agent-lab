'use client';

import { useCallback, useEffect, useMemo } from 'react';
import type { ItemStatus, ItemWithState } from '@/lib/types';
import { useRadarStore } from '@/lib/stores/radar-store';
import { useItems } from '@/lib/hooks/use-items';
import NavRail, { type ViewType } from './components/shared/NavRail';
import InboxView from './components/consumption/InboxView';
import CommandPalette, {
  type PaletteAction,
} from './components/shared/CommandPalette';
import PendingChangesBanner from './components/consumption/PendingChangesBanner';
import RunsView from './components/production/RunsView';
import AgentView from './components/production/AgentView';
import AttentionView from './components/consumption/AttentionView';
import SettingsView from './components/shared/SettingsView';
import TabBar from './components/shared/TabBar';
import MobileItemsList from './components/consumption/MobileItemsList';
import MobileChatView from './components/consumption/MobileChatView';
import { useIsMobile } from '@/lib/hooks/useMediaQuery';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';

export default function RadarWorkspace() {
  const isMobile = useIsMobile();

  // ── Store selectors (individual to avoid unnecessary re-renders) ──
  const activeView = useRadarStore((s) => s.activeView);
  const filter = useRadarStore((s) => s.filter);
  const selectedId = useRadarStore((s) => s.selectedId);
  const focusedIndex = useRadarStore((s) => s.focusedIndex);
  const paletteOpen = useRadarStore((s) => s.paletteOpen);
  const chatHeight = useRadarStore((s) => s.chatHeight);
  const traceWidth = useRadarStore((s) => s.traceWidth);
  const traceOpen = useRadarStore((s) => s.traceOpen);

  // ── SWR data fetching ────────────────────────────────────────────
  const { items: swrItems, isLoading: swrLoading, error: swrError, mutate: mutateItems } = useItems(activeView);

  const items = useRadarStore((s) => s.items);
  const loading = useRadarStore((s) => s.loading);
  const loadErr = useRadarStore((s) => s.loadErr);

  const pending = useRadarStore((s) => s.pending);
  const applyBusy = useRadarStore((s) => s.applyBusy);

  const sessions = useRadarStore((s) => s.sessions);

  const activeTrace = useRadarStore((s) => s.activeTrace);
  const highlightSpanId = useRadarStore((s) => s.highlightSpanId);
  const expandAllSignal = useRadarStore((s) => s.expandAllSignal);
  const collapseAllSignal = useRadarStore((s) => s.collapseAllSignal);

  // ── Store actions ─────────────────────────────────────────────────
  const setFilter = useRadarStore((s) => s.setFilter);
  const setSelectedId = useRadarStore((s) => s.setSelectedId);
  const setFocusedIndex = useRadarStore((s) => s.setFocusedIndex);
  const setPaletteOpen = useRadarStore((s) => s.setPaletteOpen);
  const setChatHeight = useRadarStore((s) => s.setChatHeight);
  const setTraceWidth = useRadarStore((s) => s.setTraceWidth);
  const setTraceOpen = useRadarStore((s) => s.setTraceOpen);
  const handleViewChange = useRadarStore((s) => s.handleViewChange);

  const setItems = useRadarStore((s) => s.setItems);
  const setLoading = useRadarStore((s) => s.setLoading);
  const setLoadErr = useRadarStore((s) => s.setLoadErr);

  const markPending = useRadarStore((s) => s.markPending);
  const discardPending = useRadarStore((s) => s.discardPending);
  const applyPending = useRadarStore((s) => s.applyPending);

  const loadSession = useRadarStore((s) => s.loadSession);
  const updateSession = useRadarStore((s) => s.updateSession);

  const setActiveTrace = useRadarStore((s) => s.setActiveTrace);
  const setHighlightSpanId = useRadarStore((s) => s.setHighlightSpanId);
  const triggerExpandAll = useRadarStore((s) => s.triggerExpandAll);
  const triggerCollapseAll = useRadarStore((s) => s.triggerCollapseAll);

  // ── Sync SWR data into the store ──────────────────────────────────
  useEffect(() => {
    setItems(swrItems);
  }, [swrItems, setItems]);

  useEffect(() => {
    setLoading(swrLoading);
  }, [swrLoading, setLoading]);

  useEffect(() => {
    setLoadErr(swrError ? String(swrError) : null);
  }, [swrError, setLoadErr]);

  // ── Load session on selectedId change ─────────────────────────────
  useEffect(() => {
    if (selectedId) loadSession(selectedId);
  }, [selectedId, loadSession]);

  // ── Derived state ─────────────────────────────────────────────────

  const effectiveStatus = useCallback(
    (it: ItemWithState): ItemStatus => pending[it.id] ?? it.status,
    [pending],
  );

  const filteredItems = useMemo(() => {
    return items.filter((it) => {
      if (filter === 'all') return true;
      return it.grade === filter;
    });
  }, [items, filter]);

  // Clamp focusedIndex to filtered range
  useEffect(() => {
    if (focusedIndex >= filteredItems.length) {
      setFocusedIndex(Math.max(0, filteredItems.length - 1));
    }
  }, [filteredItems.length, focusedIndex, setFocusedIndex]);

  const selectedItem = useMemo(
    () => items.find((it) => it.id === selectedId) ?? null,
    [items, selectedId],
  );

  const handleChatUpdate = useCallback(
    (msgs: import('ai').Message[]) => {
      if (!selectedId) return;
      updateSession(selectedId, msgs);
    },
    [selectedId, updateSession],
  );

  const currentSession = selectedId ? sessions[selectedId] : null;

  const itemsForList = useMemo(
    () =>
      filteredItems.map((it) => ({
        ...it,
        status: effectiveStatus(it),
      })),
    [filteredItems, effectiveStatus],
  );

  // ── Keyboard layer ────────────────────────────────────────────────
  useEffect(() => {
    function isTyping(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (!t) return false;
      return (
        t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.isContentEditable
      );
    }

    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (paletteOpen) return;

      if (e.key === 'Escape') {
        if (traceOpen) {
          setTraceOpen(false);
          return;
        }
        if (selectedId && !isTyping(e)) {
          setSelectedId(null);
          return;
        }
      }

      if (isTyping(e)) return;

      const key = e.key.toLowerCase();
      if (key === 'j') {
        e.preventDefault();
        if (filteredItems.length === 0) return;
        const next = Math.min(focusedIndex + 1, filteredItems.length - 1);
        setFocusedIndex(next);
        const it = filteredItems[next];
        if (it) {
          setSelectedId(it.id);
          setActiveTrace(null);
        }
      } else if (key === 'k') {
        e.preventDefault();
        if (filteredItems.length === 0) return;
        const next = Math.max(focusedIndex - 1, 0);
        setFocusedIndex(next);
        const it = filteredItems[next];
        if (it) {
          setSelectedId(it.id);
          setActiveTrace(null);
        }
      } else if (key === 't') {
        e.preventDefault();
        if (selectedId) setTraceOpen(!traceOpen);
      } else if (key === '/') {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (key === '?') {
        e.preventDefault();
        toast('⌘K search · J/K navigate · T trace · W/D/X mark · Esc back');
      } else if (key === 'w' || key === 'd' || key === 'x') {
        e.preventDefault();
        const it = filteredItems[focusedIndex];
        if (!it) return;
        const next: ItemStatus =
          key === 'w' ? 'watching' : key === 'd' ? 'discussed' : 'dismissed';
        markPending(it.id, next);
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    paletteOpen,
    traceOpen,
    selectedId,
    filteredItems,
    focusedIndex,
    markPending,
    setPaletteOpen,
    setTraceOpen,
    setSelectedId,
    setFocusedIndex,
    setActiveTrace,
  ]);

  // ── Palette actions ───────────────────────────────────────────────
  const actions: PaletteAction[] = useMemo(() => {
    const list: PaletteAction[] = [
      {
        id: 'filter-all',
        label: 'Filter: all',
        hint: 'Filter',
        run: () => setFilter('all'),
      },
      {
        id: 'filter-fire',
        label: 'Filter: fire only',
        hint: 'Filter',
        run: () => setFilter('fire'),
      },
      {
        id: 'filter-bolt',
        label: 'Filter: bolt only',
        hint: 'Filter',
        run: () => setFilter('bolt'),
      },
      {
        id: 'filter-bulb',
        label: 'Filter: bulb only',
        hint: 'Filter',
        run: () => setFilter('bulb'),
      },
      {
        id: 'toggle-trace',
        label: traceOpen ? 'Close trace panel' : 'Open trace panel',
        hint: 'View',
        run: () => setTraceOpen(!traceOpen),
        enabled: !!selectedId,
      },
      {
        id: 'expand-all',
        label: 'Expand all spans',
        hint: 'View',
        run: () => triggerExpandAll(),
        enabled: traceOpen,
      },
      {
        id: 'collapse-all',
        label: 'Collapse all spans',
        hint: 'View',
        run: () => triggerCollapseAll(),
        enabled: traceOpen,
      },
      {
        id: 'deselect',
        label: 'Deselect current item',
        hint: 'View',
        run: () => setSelectedId(null),
        enabled: !!selectedId,
      },
      {
        id: 'mark-watching',
        label: 'Mark current as watching',
        hint: 'Action',
        run: () => selectedId && markPending(selectedId, 'watching'),
        enabled: !!selectedId,
      },
      {
        id: 'mark-discussed',
        label: 'Mark current as discussed',
        hint: 'Action',
        run: () => selectedId && markPending(selectedId, 'discussed'),
        enabled: !!selectedId,
      },
      {
        id: 'mark-dismissed',
        label: 'Mark current as dismissed',
        hint: 'Action',
        run: () => selectedId && markPending(selectedId, 'dismissed'),
        enabled: !!selectedId,
      },
    ];
    return list;
  }, [
    traceOpen,
    selectedId,
    markPending,
    setFilter,
    setTraceOpen,
    triggerExpandAll,
    triggerCollapseAll,
    setSelectedId,
  ]);

  // ─── Mobile Layout ──────────────────────────────────────────
  if (isMobile === undefined) {
    return <div className="grid grid-rows-[40px_1fr] h-screen" />;
  }

  if (isMobile) {
    const mobileSelectItem = (item: ItemWithState) => {
      setSelectedId(item.id);
    };
    const mobileSwipeAction = async (
      itemId: string,
      action: 'watching' | 'dismissed',
    ) => {
      markPending(itemId, action);
      try {
        await fetch(`/api/items/${itemId}/state`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: action }),
        });
        setItems(
          items.map((it) =>
            it.id === itemId ? { ...it, status: action } : it,
          ),
        );
      } catch {
        // Revert on failure
      }
      // Remove from pending — use store's markPending to toggle off
      markPending(itemId, action);
    };

    return (
      <div className="flex flex-col h-[100dvh] bg-[var(--ag-bg)] text-[var(--ag-text)]">
        {selectedItem && currentSession !== undefined ? (
          <MobileChatView
            key={selectedItem.id}
            item={selectedItem}
            initialMessages={currentSession?.messages ?? []}
            sessionId={currentSession?.session_id ?? null}
            onBack={() => setSelectedId(null)}
            onChatUpdate={handleChatUpdate}
          />
        ) : (
          <>
            <div className="flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch] pb-[env(safe-area-inset-bottom,0)]">
              {activeView === 'sources' || activeView === 'runs' ? (
                <RunsView />
              ) : activeView === 'agent' ? (
                <AgentView />
              ) : activeView === 'attention' ? (
                <AttentionView />
              ) : activeView === 'settings' ? (
                <SettingsView />
              ) : (
                <MobileItemsList
                  items={itemsForList}
                  filter={filter}
                  onFilterChange={(f) => {
                    setFilter(f);
                  }}
                  onSelect={mobileSelectItem}
                  onSwipeAction={mobileSwipeAction}
                  pendingMap={pending}
                />
              )}
            </div>
            <TabBar activeView={activeView} onViewChange={handleViewChange} />
          </>
        )}
        <Toaster position="bottom-center" />
      </div>
    );
  }

  // ─── Desktop Layout ────────────────────────────────────────
  return (
    <div className="grid grid-rows-[40px_1fr] h-screen">
      <div className="flex items-center gap-3 px-[14px] pl-[18px] border-b border-border bg-surface-hi">
        <div className="font-semibold text-[13px] tracking-[-0.005em] text-text">agent-lab</div>
        <div className="flex items-center gap-1.5 text-text-3 text-xs">
          <span className="text-text-faint">/</span>
          <span>radar</span>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          className="cmdk-hint"
          onClick={() => setPaletteOpen(true)}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <span>Search &amp; run</span>
          <span className="kbd">
            <kbd className="k">⌘</kbd>
            <kbd className="k">K</kbd>
          </span>
        </button>
        <span className="py-0.5 px-2 border border-border-hi rounded-full font-[var(--mono)] text-[10.5px] text-text-2 bg-bg">
          {loading
            ? 'loading…'
            : loadErr
              ? 'load error'
              : `${items.length} items`}
        </span>
        <div className="w-[22px] h-[22px] rounded-full bg-accent-brand text-white inline-flex items-center justify-center text-[10px] font-semibold">A</div>
      </div>

      <PendingChangesBanner
        pending={pending}
        busy={applyBusy}
        onApply={async () => {
          await applyPending();
          const storeToast = useRadarStore.getState().toast;
          if (storeToast) toast(storeToast);
        }}
        onDiscard={discardPending}
      />

      <div className="grid grid-cols-[52px_1fr] overflow-hidden min-h-0 relative">
        <NavRail activeView={activeView} onViewChange={handleViewChange} />
        {activeView === 'sources' || activeView === 'runs' ? (
          <RunsView />
        ) : activeView === 'agent' ? (
          <AgentView />
        ) : activeView === 'attention' ? (
          <div className="overflow-y-auto p-6 px-8 min-w-0 min-h-0 flex-1 relative">
            <AttentionView />
          </div>
        ) : activeView === 'settings' ? (
          <div className="overflow-y-auto p-6 px-8 min-w-0 min-h-0 flex-1 relative">
            <SettingsView />
          </div>
        ) : (
          <InboxView />
        )}
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={items}
        actions={actions}
        onPickItem={(it) => {
          const idx = filteredItems.findIndex((x) => x.id === it.id);
          if (idx >= 0) {
            setFocusedIndex(idx);
          } else {
            setFilter('all');
            setFocusedIndex(items.findIndex((x) => x.id === it.id));
          }
          setSelectedId(it.id);
          setActiveTrace(null);
        }}
      />

      <Toaster position="bottom-center" />
    </div>
  );
}
