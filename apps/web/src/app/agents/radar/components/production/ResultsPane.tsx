'use client';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

// ── Types ────────────────────────────────────────────────

export interface ResultBatch {
  runId: string;
  startedAt: string;
  evaluated: number;
  promoted: number;
  rejected: number;
  totalMs: number;
  error?: string | null;
  preview: Array<{ grade: string; title: string; url?: string; why?: string; summary?: string }>;
}

interface Props {
  batches: ResultBatch[];
  currentIndex: number;
  onNavigate: (index: number) => void;
  running?: boolean;
}

// ── Helpers ──────────────────────────────────────────────

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

const gradeStyle: Record<string, string> = {
  fire: 'border-fire text-fire bg-[var(--fire-bg,var(--fire-soft))]',
  bolt: 'border-bolt text-bolt bg-[var(--bolt-bg,var(--bolt-soft))]',
  bulb: 'border-bulb text-bulb bg-[var(--bulb-bg,var(--bulb-soft))]',
};

// ── Component ────────────────────────────────────────────

export default function ResultsPane({ batches, currentIndex, onNavigate, running }: Props) {
  const batch = batches[currentIndex] ?? null;
  const total = batches.length;

  if (total === 0 && !running) {
    return (
      <div className="h-full flex items-center justify-center text-[12px] text-text-3">
        暂无推送结果，点击执行开始评判
      </div>
    );
  }

  if (running && !batch) {
    return (
      <div className="h-full flex items-center justify-center text-[12px] text-text-3">
        <span className="w-1.5 h-1.5 rounded-full bg-bolt animate-pulse mr-2" />
        评判执行中…
      </div>
    );
  }

  if (!batch) return null;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header: summary + pagination */}
      <div className="flex items-center justify-between px-4 py-1 shrink-0">
        <div className="flex items-center gap-1.5 text-[11px] text-text-3">
          {batch.error ? (
            <span className="text-fire">执行失败</span>
          ) : (
            <>
              <span>推荐 {batch.promoted}/{batch.evaluated} 条</span>
              <span>·</span>
              <span>{(batch.totalMs / 1000).toFixed(1)}s</span>
            </>
          )}
          <span>·</span>
          <span>{relTime(batch.startedAt)}</span>
        </div>
        {total > 1 && (
          <div className="flex items-center gap-1.5 text-[12px]">
            <button
              className="w-6 h-6 flex items-center justify-center rounded border border-border text-text-2 hover:bg-bg-sunk cursor-pointer disabled:opacity-30 disabled:cursor-default"
              disabled={currentIndex >= total - 1}
              onClick={() => onNavigate(currentIndex + 1)}
            >
              ←
            </button>
            <span className="text-text-3 min-w-[40px] text-center">
              {total - currentIndex}/{total}
            </span>
            <button
              className="w-6 h-6 flex items-center justify-center rounded border border-border text-text-2 hover:bg-bg-sunk cursor-pointer disabled:opacity-30 disabled:cursor-default"
              disabled={currentIndex <= 0}
              onClick={() => onNavigate(currentIndex - 1)}
            >
              →
            </button>
          </div>
        )}
      </div>

      {/* Result cards grid */}
      <div className="flex-1 overflow-y-auto p-3">
        {batch.error ? (
          <div className="text-[12px] text-fire p-3 bg-[var(--fire-bg,rgba(239,68,68,.08))] rounded-[8px]">
            {batch.error}
          </div>
        ) : batch.preview.length === 0 ? (
          <div className="text-[12px] text-text-3 p-3 text-center">
            本轮无推荐内容
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-2.5">
            {batch.preview.map((item, i) => (
              <div
                key={`${batch.runId}-${i}`}
                className="border border-border rounded-[8px] p-3 bg-surface hover:shadow-[0_2px_8px_rgba(0,0,0,.06)] transition-shadow"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <Badge
                    variant="outline"
                    className={cn('text-[10px] px-1.5 py-0 h-5', gradeStyle[item.grade])}
                  >
                    {item.grade}
                  </Badge>
                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto text-[10px] text-text-3 hover:text-accent-brand no-underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      ↗ 原文
                    </a>
                  )}
                </div>
                <div className="font-semibold text-[13px] leading-[1.5] mb-1">{item.title}</div>
                {item.summary && (
                  <div className="text-[12px] text-text-2 leading-[1.5] mb-1.5">
                    {item.summary}
                  </div>
                )}
                {item.why && (
                  <div className="text-[11px] text-bolt leading-[1.4] p-1.5 px-2 bg-[var(--bolt-bg)] rounded-[4px]">
                    {item.why}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
