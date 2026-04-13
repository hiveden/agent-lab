'use client';

import type { ViewType } from './NavRail';
import { cn } from '@/lib/utils';

interface TabBarProps {
  activeView: ViewType;
  onViewChange: (view: ViewType) => void;
}

const TABS: { view: ViewType; label: string; icon: string }[] = [
  { view: 'inbox', label: 'Inbox', icon: '📥' },
  { view: 'watching', label: 'Watch', icon: '👁' },
  { view: 'attention', label: 'Mirror', icon: '🪞' },
  { view: 'runs', label: 'Runs', icon: '⚡' },
  { view: 'settings', label: 'Settings', icon: '⚙' },
];

export default function TabBar({ activeView, onViewChange }: TabBarProps) {
  return (
    <nav className="flex border-t border-[var(--ag-border)] bg-[var(--surface-hi,var(--ag-bg))] pb-[env(safe-area-inset-bottom,0)]">
      {TABS.map((tab) => (
        <button
          key={tab.view}
          className={cn(
            'flex-1 flex flex-col items-center gap-0.5 pt-2 pb-1.5 bg-transparent border-none text-[var(--ag-text-2)] text-[10px] cursor-pointer [-webkit-tap-highlight-color:transparent]',
            activeView === tab.view && 'text-[var(--ag-text)]',
          )}
          onClick={() => onViewChange(tab.view)}
          aria-label={tab.label}
        >
          <span className="text-lg leading-none">{tab.icon}</span>
          <span className="font-medium">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
