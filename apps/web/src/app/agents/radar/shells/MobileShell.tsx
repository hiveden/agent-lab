'use client';

/**
 * MobileShell — compact viewport 布局壳（Step 1）。
 *
 * 当前职责：
 * - 全屏单栏（列表 / 详情二选一）
 * - 底部 TabBar
 *
 * Step 1 范围：把 RadarWorkspace 原 `if (isMobile)` 分支的 JSX 搬家进来，
 * 业务逻辑（keyboard / pending / store sync）留在 RadarWorkspace，通过 props
 * 注入。Step 5 Primitives 抽取时再拆共用 hook。
 */

import { Toaster } from '@/components/ui/sonner';
import type { ItemStatus, ItemWithState } from '@/lib/types';
import type { ViewType } from '../components/shared/NavRail';
import type { GradeFilter } from '../components/consumption/ItemsList';
import MobileChatView from '../components/consumption/MobileChatView';
import MobileItemsList from '../components/consumption/MobileItemsList';
import PendingChangesSheet from '../components/consumption/PendingChangesSheet';
import RunsView from '../components/production/RunsView';
import AgentView from '../components/production/AgentView';
import AttentionView from '../components/consumption/AttentionView';
import SettingsView from '../components/shared/SettingsView';
import TabBar from '../components/shared/TabBar';

export interface MobileShellProps {
  activeView: ViewType;
  filter: GradeFilter;
  itemsForList: ItemWithState[];
  selectedItem: ItemWithState | null;
  pending: Record<string, ItemStatus>;
  applyBusy: boolean;

  setFilter: (f: GradeFilter) => void;
  setSelectedId: (id: string | null) => void;
  handleViewChange: (view: ViewType) => void;
  mobileSelectItem: (item: ItemWithState) => void;
  mobileSwipeAction: (itemId: string, action: 'watching' | 'dismissed') => Promise<void>;
  applyPending: () => Promise<void>;
  discardPending: () => void;
}

export default function MobileShell(props: MobileShellProps) {
  const {
    activeView,
    filter,
    itemsForList,
    selectedItem,
    pending,
    applyBusy,
    setFilter,
    setSelectedId,
    handleViewChange,
    mobileSelectItem,
    mobileSwipeAction,
    applyPending,
    discardPending,
  } = props;

  return (
    <div className="flex flex-col h-[100dvh] bg-[var(--ag-bg)] text-[var(--ag-text)]">
      {selectedItem ? (
        <MobileChatView
          key={selectedItem.id}
          item={selectedItem}
          onBack={() => setSelectedId(null)}
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
                onFilterChange={setFilter}
                onSelect={mobileSelectItem}
                onSwipeAction={mobileSwipeAction}
                pendingMap={pending}
              />
            )}
          </div>
          <PendingChangesSheet
            pending={pending}
            busy={applyBusy}
            onApply={applyPending}
            onDiscard={discardPending}
          />
          <TabBar activeView={activeView} onViewChange={handleViewChange} />
        </>
      )}
      <Toaster position="bottom-center" />
    </div>
  );
}
