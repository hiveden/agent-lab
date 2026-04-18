'use client';

import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { otelTraceEvents } from '@/lib/otel-browser';

/**
 * 显示当前 chat 的 OTel trace_id 短码 (前 8 位)，hover 看完整 32-hex，
 * 点击复制 + 跳 Langfuse trace 详情页。
 *
 * 详见 docs/22 ADR-002c (Phase 3 修正) — trace_id 来源从 BaseEvent.runId 改为
 * 浏览器 OTel SDK 当前 chat fetch span 的 trace_id (与 BFF/Python OTel trace_id
 * 一致)。Langfuse v4 OTel-native, trace_id 用 32-hex 形式存储/查询。
 */
export default function TraceLinkChip() {
  const [copied, setCopied] = useState(false);
  const [traceIdHex, setTraceIdHex] = useState<string | null>(null);

  // 从 otel-browser 派发的 chat-trace 事件拿 trace_id (32-hex)
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ traceId: string }>).detail;
      if (detail?.traceId) setTraceIdHex(detail.traceId);
    };
    otelTraceEvents.addEventListener('chat-trace', handler);
    return () => otelTraceEvents.removeEventListener('chat-trace', handler);
  }, []);

  const host = process.env.NEXT_PUBLIC_LANGFUSE_HOST || 'https://us.cloud.langfuse.com';
  const projectId = process.env.NEXT_PUBLIC_LANGFUSE_PROJECT_ID;

  const langfuseUrl = traceIdHex && projectId
    ? `${host}/project/${projectId}/traces/${traceIdHex}`
    : host;

  const onCopy = useCallback(async () => {
    if (!traceIdHex) return;
    try {
      await navigator.clipboard.writeText(traceIdHex);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard 不可用 */
    }
  }, [traceIdHex]);

  if (!traceIdHex) {
    return (
      <span className="text-[10px] text-text-3 font-mono tracking-tight" title="尚未发起 chat (浏览器 OTel SDK 等首次 fetch)">
        trace: —
      </span>
    );
  }

  const short = traceIdHex.slice(0, 8);

  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono">
      <span className="text-text-3">trace:</span>
      <button
        type="button"
        onClick={onCopy}
        title={`点击复制完整 trace_id\n${traceIdHex}`}
        className={cn(
          'px-1.5 py-[1px] rounded border border-border-hi bg-surface text-text-2',
          'cursor-pointer transition-all duration-100 hover:border-accent-line hover:bg-accent-soft hover:text-accent-brand',
        )}
      >
        {copied ? '已复制' : short}
      </button>
      <a
        href={langfuseUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={projectId ? '在 Langfuse 中查看此 trace' : '打开 Langfuse (设 NEXT_PUBLIC_LANGFUSE_PROJECT_ID 后可精准跳转)'}
        className="px-1.5 py-[1px] rounded border border-border-hi bg-surface text-text-3 hover:text-accent-brand hover:border-accent-line hover:bg-accent-soft transition-all duration-100"
      >
        Langfuse ↗
      </a>
    </span>
  );
}
