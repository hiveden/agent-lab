'use client';

export type ViewType = 'inbox' | 'watching' | 'archive' | 'sources' | 'runs';

export interface NavRailProps {
  activeView?: ViewType;
  onViewChange?: (view: ViewType) => void;
}

export default function NavRail({
  activeView = 'inbox',
  onViewChange,
}: NavRailProps) {
  return (
    <aside className="nav-rail">
      <button className="nav-item active" data-tip="Radar" aria-label="Radar">
        R
      </button>
      <button
        className="nav-item disabled"
        data-tip="Pulse · soon"
        disabled
        aria-label="Pulse (soon)"
      >
        P
      </button>
      <button
        className="nav-item disabled"
        data-tip="Scout · soon"
        disabled
        aria-label="Scout (soon)"
      >
        S
      </button>
      <div className="nav-sep" />

      {/* Inbox */}
      <button
        className={`nav-item ${activeView === 'inbox' ? 'active' : ''}`}
        data-tip="Inbox"
        aria-label="Inbox"
        onClick={() => onViewChange?.('inbox')}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M22 12h-6l-2 3h-4l-2-3H2" />
          <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
        </svg>
      </button>

      {/* Watching */}
      <button
        className={`nav-item ${activeView === 'watching' ? 'active' : ''}`}
        data-tip="Watching"
        aria-label="Watching"
        onClick={() => onViewChange?.('watching')}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      </button>

      {/* Archive */}
      <button
        className={`nav-item ${activeView === 'archive' ? 'active' : ''}`}
        data-tip="Archive"
        aria-label="Archive"
        onClick={() => onViewChange?.('archive')}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="2" y="4" width="20" height="5" rx="2" ry="2" />
          <path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9" />
          <path d="M10 13h4" />
        </svg>
      </button>

      <div className="nav-sep" />

      {/* Sources */}
      <button
        className={`nav-item ${activeView === 'sources' ? 'active' : ''}`}
        data-tip="Sources"
        aria-label="Sources"
        onClick={() => onViewChange?.('sources')}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
        </svg>
      </button>

      {/* Runs */}
      <button
        className={`nav-item ${activeView === 'runs' ? 'active' : ''}`}
        data-tip="Runs"
        aria-label="Runs"
        onClick={() => onViewChange?.('runs')}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      </button>

      <div className="spacer" />
      <button className="nav-item" data-tip="Settings" aria-label="Settings">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h.01a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v.01a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
      </button>
    </aside>
  );
}
