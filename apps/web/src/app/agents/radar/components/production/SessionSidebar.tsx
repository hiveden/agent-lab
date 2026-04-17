'use client';

import { cn } from '@/lib/utils';
import type { SessionSummary } from '@/lib/hooks/use-session-list';

function relTime(iso: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return '刚刚';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}小时前`;
  const d = Math.floor(h / 24);
  return `${d}天前`;
}

interface SessionSidebarProps {
  sessions: SessionSummary[];
  activeId: string;
  loading: boolean;
  onNew: () => void;
  onSwitch: (id: string) => void;
}

export default function SessionSidebar({ sessions, activeId, loading, onNew, onSwitch }: SessionSidebarProps) {
  return (
    <aside className="w-[200px] shrink-0 border-r border-border flex flex-col">
      {/* Header with + button */}
      <div className="p-3 border-b border-border flex items-center justify-between">
        <span className="font-semibold text-[12px]">会话</span>
        <button
          className="text-[11px] text-text-3 hover:text-accent-brand cursor-pointer"
          onClick={onNew}
        >
          + 新建
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {loading && sessions.length === 0 && (
          <div className="p-3 text-[11px] text-text-3">加载中...</div>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            data-thread-id={s.id}
            className={cn(
              'px-3 py-2.5 cursor-pointer border-b border-border text-[12px] transition-colors',
              s.id === activeId
                ? 'bg-accent-soft border-l-2 border-l-accent-brand'
                : 'hover:bg-surface-hi',
            )}
            onClick={() => onSwitch(s.id)}
          >
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="font-medium text-text truncate">
                {s.preview || '新会话'}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-text-3">
              <span>{relTime(s.created_at)}</span>
              {s.result_summary && (
                <span>推 {s.result_summary.promoted} / 滤 {s.result_summary.rejected}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
