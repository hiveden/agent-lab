'use client';

import { Inbox, Eye, GitCompare, Activity, Settings } from 'lucide-react';
import type { ViewType } from './NavRail';
import { cn } from '@/lib/utils';

interface TabBarProps {
  activeView: ViewType;
  onViewChange: (view: ViewType) => void;
}

const TABS: {
  view: ViewType;
  label: string;
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
}[] = [
  { view: 'inbox', label: 'Inbox', Icon: Inbox },
  { view: 'watching', label: 'Watch', Icon: Eye },
  { view: 'attention', label: 'Mirror', Icon: GitCompare },
  { view: 'runs', label: 'Runs', Icon: Activity },
  { view: 'settings', label: 'Settings', Icon: Settings },
];

export default function TabBar({ activeView, onViewChange }: TabBarProps) {
  return (
    <nav className="flex border-t border-[var(--border)] bg-[var(--surface-hi,var(--surface))] pb-[env(safe-area-inset-bottom,0)]">
      {TABS.map(({ view, label, Icon }) => {
        const active = activeView === view;
        return (
          <button
            key={view}
            className={cn(
              'flex-1 flex flex-col items-center gap-1 pt-2 pb-1.5',
              'bg-transparent border-none cursor-pointer',
              '[-webkit-tap-highlight-color:transparent] transition-colors duration-150',
              'text-[10.5px] font-medium tracking-wide',
              active ? 'text-[var(--text)]' : 'text-[var(--text-2)]',
            )}
            onClick={() => onViewChange(view)}
            aria-label={label}
          >
            <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
