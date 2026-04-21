import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ItemStatus, ItemWithState } from '@/lib/types';
import type { GradeFilter } from '@/app/agents/radar/components/consumption/ItemsList';
import type { ViewType } from '@/app/agents/radar/components/shared/NavRail';
import type { MockTrace } from '@/app/agents/radar/traceMock';
import type { Message } from 'ai';
import { queryClient } from '@/lib/providers/query-provider';

// ── Types ──────────────────────────────────────────────────────────

export interface SessionState {
  session_id: string | null;
  messages: Message[];
}

// ── State interfaces (per slice) ───────────────────────────────────

interface UISlice {
  activeView: ViewType;
  filter: GradeFilter;
  selectedId: string | null;
  focusedIndex: number;
  paletteOpen: boolean;
  toast: string | null;
  chatHeight: number;
  traceWidth: number;
  traceOpen: boolean;
}

interface ItemsSlice {
  items: ItemWithState[];
  loading: boolean;
  loadErr: string | null;
}

interface PendingSlice {
  pending: Record<string, ItemStatus>;
  applyBusy: boolean;
}

interface SessionsSlice {
  sessions: Record<string, SessionState>;
}

interface TraceSlice {
  activeTrace: MockTrace | null;
  highlightSpanId: string | null;
  expandAllSignal: number;
  collapseAllSignal: number;
}

// ── Actions ────────────────────────────────────────────────────────

interface UIActions {
  setActiveView: (view: ViewType) => void;
  setFilter: (filter: GradeFilter) => void;
  setSelectedId: (id: string | null) => void;
  setFocusedIndex: (index: number) => void;
  setPaletteOpen: (open: boolean) => void;
  setToast: (msg: string | null) => void;
  setChatHeight: (h: number) => void;
  setTraceWidth: (w: number) => void;
  setTraceOpen: (open: boolean) => void;
  /** Reset selection-related state when switching views */
  handleViewChange: (view: ViewType) => void;
}

interface ItemsActions {
  setItems: (items: ItemWithState[]) => void;
  setLoading: (loading: boolean) => void;
  setLoadErr: (err: string | null) => void;
  /** Fetch items from API based on activeView */
  reloadItems: () => Promise<void>;
}

interface PendingActions {
  /** Toggle a pending status change for an item (same status again = remove) */
  markPending: (id: string, status: ItemStatus) => void;
  discardPending: () => void;
  /** Apply all pending changes via PATCH, then reconcile local items */
  applyPending: () => Promise<void>;
}

interface SessionsActions {
  /** Load chat session for an item from API (no-op if already cached) */
  loadSession: (itemId: string) => Promise<void>;
  /** Update messages for the currently-selected item's session */
  updateSession: (itemId: string, messages: Message[]) => void;
}

interface TraceActions {
  setActiveTrace: (trace: MockTrace | null) => void;
  setHighlightSpanId: (id: string | null) => void;
  triggerExpandAll: () => void;
  triggerCollapseAll: () => void;
}

// ── Combined store type ────────────────────────────────────────────

export type RadarStore = UISlice &
  ItemsSlice &
  PendingSlice &
  SessionsSlice &
  TraceSlice &
  UIActions &
  ItemsActions &
  PendingActions &
  SessionsActions &
  TraceActions;

// ── Persisted keys ─────────────────────────────────────────────────

type PersistedState = Pick<
  RadarStore,
  'activeView' | 'filter' | 'selectedId' | 'traceWidth' | 'traceOpen' | 'chatHeight'
>;

// ── Store ──────────────────────────────────────────────────────────

export const useRadarStore = create<RadarStore>()(
  persist(
    (set, get) => ({
      // ── UI slice (defaults) ──────────────────────────────────
      activeView: 'inbox' as ViewType,
      filter: 'all' as GradeFilter,
      selectedId: null,
      focusedIndex: 0,
      paletteOpen: false,
      toast: null,
      chatHeight: 300,
      traceWidth: 440,
      traceOpen: false,

      // ── Items slice ──────────────────────────────────────────
      items: [],
      loading: true,
      loadErr: null,

      // ── Pending slice ────────────────────────────────────────
      pending: {},
      applyBusy: false,

      // ── Sessions slice ───────────────────────────────────────
      sessions: {},

      // ── Trace slice ──────────────────────────────────────────
      activeTrace: null,
      highlightSpanId: null,
      expandAllSignal: 0,
      collapseAllSignal: 0,

      // ── UI actions ───────────────────────────────────────────
      setActiveView: (view) => set({ activeView: view }),
      setFilter: (filter) => set({ filter }),
      setSelectedId: (id) => set({ selectedId: id }),
      setFocusedIndex: (index) => set({ focusedIndex: index }),
      setPaletteOpen: (open) => set({ paletteOpen: open }),
      setToast: (msg) => set({ toast: msg }),
      setChatHeight: (h) => set({ chatHeight: h }),
      setTraceWidth: (w) => set({ traceWidth: w }),
      setTraceOpen: (open) => set({ traceOpen: open }),

      handleViewChange: (view) =>
        set({
          activeView: view,
          focusedIndex: 0,
          selectedId: null,
          activeTrace: null,
          highlightSpanId: null,
        }),

      // ── Items actions ────────────────────────────────────────
      setItems: (items) => {
        const current = get().items;
        // Skip if same length and same IDs to prevent SWR sync loops
        if (
          current.length === items.length &&
          current.every((it, i) => it.id === items[i]?.id && it.status === items[i]?.status)
        ) return;
        set({ items });
      },
      setLoading: (loading) => {
        if (get().loading !== loading) set({ loading });
      },
      setLoadErr: (err) => {
        if (get().loadErr !== err) set({ loadErr: err });
      },

      reloadItems: async () => {
        const { activeView } = get();
        try {
          set({ loading: true });
          let statusParam = 'unread';
          if (activeView === 'watching') statusParam = 'watching';
          else if (activeView === 'archive')
            statusParam = 'dismissed,discussed,applied,rejected';

          const res = await fetch(
            `/api/items?agent_id=radar&limit=400&status=${statusParam}`,
          );
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const body = (await res.json()) as { items: ItemWithState[] };
          set({ items: body.items ?? [], loadErr: null });
        } catch (e) {
          set({ loadErr: String(e) });
        } finally {
          set({ loading: false });
        }
      },

      // ── Pending actions ──────────────────────────────────────
      markPending: (id, status) =>
        set((state) => {
          if (state.pending[id] === status) {
            const { [id]: _, ...rest } = state.pending;
            return { pending: rest };
          }
          return { pending: { ...state.pending, [id]: status } };
        }),

      discardPending: () => set({ pending: {} }),

      applyPending: async () => {
        const { pending, activeView } = get();
        const entries = Object.entries(pending);
        if (entries.length === 0) return;

        set({ applyBusy: true });

        const results = await Promise.allSettled(
          entries.map(([id, status]) =>
            fetch(`/api/items/${id}/state`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ status }),
            }),
          ),
        );

        // Optimistically update items and filter out those no longer matching
        set((state) => {
          const updated = state.items
            .map((it) => {
              const next = state.pending[it.id];
              return next ? { ...it, status: next } : it;
            })
            .filter((it) => {
              if (activeView === 'inbox' && it.status !== 'unread') return false;
              if (activeView === 'watching' && it.status !== 'watching')
                return false;
              if (
                activeView === 'archive' &&
                !['dismissed', 'discussed', 'applied', 'rejected'].includes(
                  it.status,
                )
              )
                return false;
              return true;
            });

          const failed = results.filter((r) => r.status === 'rejected').length;
          return {
            items: updated,
            pending: {},
            applyBusy: false,
            toast: failed ? `Applied (${failed} failed)` : 'Changes applied',
          };
        });

        // TanStack Query cache invalidation（ADR-2 Phase 0.3）：
        // 上面的 set() 已乐观更新本地 items 快照；再触发 useItems 的 query 重取
        // 保证 cache 与服务端最终一致（双保险：UI 立刻响应 + 后台校准）。
        // 'items' 前缀匹配所有 useItems 查询（不同 activeView 对应的 status 值）。
        queryClient.invalidateQueries({ queryKey: ['items'] });
      },

      // ── Sessions actions ─────────────────────────────────────
      loadSession: async (itemId) => {
        const { sessions } = get();
        if (sessions[itemId]) return; // already cached
        try {
          const res = await fetch(`/api/chat/sessions/${itemId}`);
          if (!res.ok) return;
          interface StoredMetadata {
            toolCalls?: Array<{ id: string; name: string; args: unknown }>;
            annotations?: Array<Record<string, unknown>>;
          }
          const j = (await res.json()) as {
            session_id: string | null;
            messages: Array<{ id: string; role: string; content: string; tool_calls?: unknown[] | null }>;
          };
          const msgs: Message[] = (j.messages ?? [])
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => {
              // Parse stored metadata: [{ toolCalls, annotations }]
              const meta = (m.tool_calls?.[0] ?? null) as StoredMetadata | null;
              const toolCalls = meta?.toolCalls ?? [];
              const annotations = meta?.annotations ?? [];

              return {
                id: m.id,
                role: m.role as 'user' | 'assistant',
                content: m.content,
                ...(toolCalls.length ? {
                  toolInvocations: toolCalls.map((tc: { id: string; name: string; args: unknown; result?: unknown }) => ({
                    state: 'result' as const,
                    toolCallId: tc.id,
                    toolName: tc.name,
                    args: tc.args,
                    result: tc.result ?? {},
                  })),
                } : {}),
                ...(annotations.length ? { annotations: annotations as import('ai').JSONValue[] } : {}),
              };
            });
          set((state) => ({
            sessions: {
              ...state.sessions,
              [itemId]: { session_id: j.session_id, messages: msgs },
            },
          }));
        } catch (e) {
          console.error('[radar-store] loadSession failed:', e);
        }
      },

      updateSession: (itemId, messages) =>
        set((state) => {
          const cur = state.sessions[itemId] ?? {
            session_id: null,
            messages: [],
          };
          return {
            sessions: {
              ...state.sessions,
              [itemId]: { ...cur, messages },
            },
          };
        }),

      // ── Trace actions ────────────────────────────────────────
      setActiveTrace: (trace) => set({ activeTrace: trace }),
      setHighlightSpanId: (id) => set({ highlightSpanId: id }),
      triggerExpandAll: () =>
        set((state) => ({ expandAllSignal: state.expandAllSignal + 1 })),
      triggerCollapseAll: () =>
        set((state) => ({ collapseAllSignal: state.collapseAllSignal + 1 })),
    }),
    {
      name: 'agent-lab.radar',
      partialize: (state): PersistedState => ({
        activeView: state.activeView,
        filter: state.filter,
        selectedId: state.selectedId,
        traceWidth: state.traceWidth,
        traceOpen: state.traceOpen,
        chatHeight: state.chatHeight,
      }),
      // Merge persisted state with defaults (skip hydration flash)
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<PersistedState>),
      }),
    },
  ),
);
