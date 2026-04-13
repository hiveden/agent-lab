'use client';

import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/hooks/use-theme';

export type ViewType = 'inbox' | 'watching' | 'archive' | 'sources' | 'runs' | 'agent' | 'attention' | 'settings';

export interface NavRailProps {
  activeView?: ViewType;
  onViewChange?: (view: ViewType) => void;
}

export default function NavRail({
  activeView = 'inbox',
  onViewChange,
}: NavRailProps) {
  const { theme, toggle } = useTheme();

  return (
    <aside className="border-r border-[var(--border)] bg-[var(--surface-hi)] flex flex-col items-center py-2.5 gap-1">
      <NavButton
        active={activeView === 'inbox' || activeView === 'watching' || activeView === 'archive'}
        tip="Radar"
        onClick={() => onViewChange?.('inbox')}
      >
        R
      </NavButton>
      <NavButton disabled tip="Pulse · soon">
        P
      </NavButton>
      <NavButton disabled tip="Scout · soon">
        S
      </NavButton>
      <div className="w-5 h-px bg-[var(--border)] my-1.5" />

      {/* Sync (Sources + Runs merged) */}
      <NavButton
        active={activeView === 'sources' || activeView === 'runs'}
        tip="同步"
        onClick={() => onViewChange?.('runs')}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      </NavButton>

      {/* Agent (Intelligence) */}
      <NavButton
        active={activeView === 'agent'}
        tip="Agent"
        onClick={() => onViewChange?.('agent')}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M12 2a4 4 0 014 4v1a4 4 0 01-8 0V6a4 4 0 014-4z" />
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
          <circle cx="12" cy="6" r="1" fill="currentColor" />
        </svg>
      </NavButton>

      {/* Attention Mirror */}
      <NavButton
        active={activeView === 'attention'}
        tip="Attention"
        onClick={() => onViewChange?.('attention')}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
          <line x1="2" y1="12" x2="22" y2="12" />
        </svg>
      </NavButton>

      <div className="flex-1" />
      <NavButton
        tip={theme === 'dark' ? 'Light mode' : 'Dark mode'}
        onClick={toggle}
      >
        {theme === 'dark' ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
          </svg>
        )}
      </NavButton>
      <NavButton
        active={activeView === 'settings'}
        tip="Settings"
        onClick={() => onViewChange?.('settings')}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h.01a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v.01a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
      </NavButton>
    </aside>
  );
}

function NavButton({
  active,
  disabled,
  tip,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  tip?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className={cn(
        'nav-item',
        'w-[34px] h-[34px] inline-flex items-center justify-center rounded-[7px] cursor-pointer text-[var(--text-3)] bg-transparent border border-transparent text-[13px] font-semibold transition-all duration-[.12s] relative',
        'hover:not-disabled:text-[var(--text)] hover:not-disabled:bg-[var(--bg-sunk)]',
        active && 'text-[var(--accent)] bg-[var(--accent-soft)] border-[var(--accent-line)]',
        disabled && 'opacity-30 cursor-not-allowed',
      )}
      data-tip={tip}
      aria-label={tip}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
