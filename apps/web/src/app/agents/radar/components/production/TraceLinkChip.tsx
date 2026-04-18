'use client';

import { useCallback, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * 显示当前 chat 的 trace_id 短码 (前 8 位)，hover 看完整 UUID，
 * 点击复制完整 UUID + 跳 Langfuse trace 详情页。
 *
 * 详见 docs/22-OBSERVABILITY-ENTERPRISE.md Phase A "前端 trace UI 缝合"。
 *
 * Langfuse URL 格式：
 * - 配了 NEXT_PUBLIC_LANGFUSE_PROJECT_ID → /project/<id>/traces/<trace>  (精准跳)
 * - 没配 → /  (Langfuse 顶层，用户自己进 Tracing 找)
 *
 * 注：Langfuse v4 是 OTel-native，URL 里的 trace_id 是 32-hex 去连字符形式
 * (即 OTel 标准 trace_id)，不是 UUID 带连字符形式。
 */
export default function TraceLinkChip({ runId }: { runId: string | null }) {
  const [copied, setCopied] = useState(false);

  const host = process.env.NEXT_PUBLIC_LANGFUSE_HOST || 'https://us.cloud.langfuse.com';
  const projectId = process.env.NEXT_PUBLIC_LANGFUSE_PROJECT_ID;

  // Langfuse URL 用 32-hex (去连字符)
  const traceIdHex = runId?.replace(/-/g, '');
  const langfuseUrl = traceIdHex && projectId
    ? `${host}/project/${projectId}/traces/${traceIdHex}`
    : host;

  const onCopy = useCallback(async () => {
    if (!runId) return;
    try {
      await navigator.clipboard.writeText(runId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard 不可用 */
    }
  }, [runId]);

  if (!runId) {
    return (
      <span className="text-[10px] text-text-3 font-mono tracking-tight" title="尚未发起 chat">
        trace: —
      </span>
    );
  }

  const short = runId.slice(0, 8);

  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono">
      <span className="text-text-3">trace:</span>
      <button
        type="button"
        onClick={onCopy}
        title={`点击复制完整 trace_id\n${runId}`}
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
