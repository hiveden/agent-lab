'use client';

/**
 * DesktopShell — expanded viewport 布局壳（Step 1）。
 *
 * 当前职责：
 * - 顶栏（agent-lab / radar + ⌘K 入口 + items 计数徽章）
 * - PendingChangesBanner（顶部）
 * - NavRail + 主内容区（resizable panel 在 InboxView 内部）
 * - CommandPalette（模态）
 *
 * Step 1 范围：搬家 RadarWorkspace 原 desktop 分支 JSX，不改业务逻辑。
 */

import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import type { ItemWithState, ItemStatus } from '@/lib/types';
import type { ViewType } from '../components/shared/NavRail';
import type { PaletteAction } from '../components/shared/CommandPalette';
import { useRadarStore } from '@/lib/stores/radar-store';
import NavRail from '../components/shared/NavRail';
import CommandPalette from '../components/shared/CommandPalette';
import PendingChangesBanner from '../components/consumption/PendingChangesBanner';
import RunsView from '../components/production/RunsView';
import AgentView from '../components/production/AgentView';
import AttentionView from '../components/consumption/AttentionView';
import SettingsView from '../components/shared/SettingsView';
import InboxView from '../components/consumption/InboxView';

export interface DesktopShellProps {
  activeView: ViewType;
  items: ItemWithState[];
  filteredItems: ItemWithState[];
  loading: boolean;
  loadErr: string | null;
  pending: Record<string, ItemStatus>;
  applyBusy: boolean;
  paletteOpen: boolean;
  actions: PaletteAction[];

  setPaletteOpen: (open: boolean) => void;
  setFilter: (f: 'all' | 'fire' | 'bolt' | 'bulb') => void;
  setSelectedId: (id: string | null) => void;
  setFocusedIndex: (i: number) => void;
  setActiveTrace: (t: null) => void;
  handleViewChange: (view: ViewType) => void;
  applyPending: () => Promise<void>;
  discardPending: () => void;
}

export default function DesktopShell(props: DesktopShellProps) {
  const {
    activeView,
    items,
    filteredItems,
    loading,
    loadErr,
    pending,
    applyBusy,
    paletteOpen,
    actions,
    setPaletteOpen,
    setFilter,
    setSelectedId,
    setFocusedIndex,
    setActiveTrace,
    handleViewChange,
    applyPending,
    discardPending,
  } = props;

  return (
    <div className="grid grid-rows-[40px_1fr] h-screen">
      <div className="flex items-center gap-3 px-[14px] pl-[18px] border-b border-border bg-surface-hi">
        <div className="font-semibold text-[13px] tracking-[-0.005em] text-text">agent-lab</div>
        <div className="flex items-center gap-1.5 text-text-3 text-xs">
          <span className="text-text-faint">/</span>
          <span>radar</span>
        </div>
        <div className="flex-1" />
        <button type="button" className="cmdk-hint" onClick={() => setPaletteOpen(true)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
          {loading ? 'loading…' : loadErr ? 'load error' : `${items.length} items`}
        </span>
        <div className="w-[22px] h-[22px] rounded-full bg-accent-brand text-white inline-flex items-center justify-center text-[10px] font-semibold">
          A
        </div>
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
