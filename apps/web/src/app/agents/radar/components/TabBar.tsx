'use client';

import type { ViewType } from './NavRail';

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
    <nav className="tab-bar">
      {TABS.map((tab) => (
        <button
          key={tab.view}
          className={`tab-item ${activeView === tab.view ? 'active' : ''}`}
          onClick={() => onViewChange(tab.view)}
          aria-label={tab.label}
        >
          <span className="tab-icon">{tab.icon}</span>
          <span className="tab-label">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
