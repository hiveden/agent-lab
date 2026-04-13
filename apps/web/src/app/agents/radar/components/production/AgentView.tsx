'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useRuns, type Run } from '@/lib/hooks/use-runs';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/fetch';
import type { Message, ToolInvocation } from 'ai';
import MessageList from '../shared/MessageList';

const DEFAULT_PROMPT = `你是 Radar,一个科技资讯策展 Agent,目标用户是正在转型 AI Agent 工程师的全栈开发者。
你的任务:从给定的内容中,挑选 3-5 条最值得推荐给用户的条目。

输出必须是严格合法的 JSON 数组,数组每个元素符合:
{
  "external_id_suffix": "<原始 id>",
  "grade": "fire | bolt | bulb",
  "title": "<简洁中文标题>",
  "summary": "<2-3 句话中文总结>",
  "why": "<为什么推给这位用户>",
  "tags": ["<2-4 个标签>"],
  "url": "<原 url>"
}

挑选偏好:AI / agent / LLM infra / 开发者工具 / 独立开发者故事。
不要返回任何 JSON 之外的内容。`;

interface SpanEvent {
  id: string;
  kind: string;
  title: string;
  status: string;
  ms?: number;
  detail?: Record<string, unknown>;
}

interface ResultEvent {
  evaluated: number;
  promoted: number;
  rejected: number;
  total_ms: number;
  preview?: Array<{ grade: string; title: string; url?: string; why?: string }>;
}

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

export default function AgentView() {
  // ── Run list ──
  const { runs: allRuns, mutate } = useRuns({ phase: 'evaluate', limit: 30 });
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // ── Prompt ──
  const [prompt, setPrompt] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('agent-lab.agent-prompt') ?? DEFAULT_PROMPT;
    }
    return DEFAULT_PROMPT;
  });
  const [editing, setEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Execution state (current run) ──
  const [running, setRunning] = useState(false);
  const [liveSpans, setLiveSpans] = useState<SpanEvent[]>([]);
  const [liveResult, setLiveResult] = useState<ResultEvent | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string>('');
  const [summarizing, setSummarizing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Derived: selected run data ──
  const selectedRun = allRuns.find((r) => r.id === selectedRunId) ?? null;
  const isLive = running && (!selectedRunId || selectedRunId === 'live');

  // Auto-select first run on load
  useEffect(() => {
    if (!selectedRunId && allRuns.length > 0) {
      setSelectedRunId(allRuns[0].id);
    }
  }, [allRuns, selectedRunId]);

  // ── Prompt helpers ──
  const savePrompt = useCallback((value: string) => {
    setPrompt(value);
    localStorage.setItem('agent-lab.agent-prompt', value);
  }, []);

  const startEditing = useCallback(() => {
    setEditing(true);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, []);

  const stopEditing = useCallback(() => {
    setEditing(false);
  }, []);

  // ── Execute ──
  const handleExecute = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setLiveSpans([]);
    setLiveResult(null);
    setLiveError(null);
    setSelectedRunId('live');

    let runId: string | null = null;
    const collectedSpans: SpanEvent[] = [];
    let collectedResult: ResultEvent | null = null;
    let collectedError: string | null = null;

    try {
      const res = await fetch('/api/cron/radar/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });

      if (!res.ok || !res.body) {
        setLiveError(`HTTP ${res.status}`);
        setRunning(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;

          let ev: Record<string, unknown>;
          try { ev = JSON.parse(data); } catch { continue; }

          if (ev.type === 'start' && ev.run_id) {
            runId = String(ev.run_id);
          } else if (ev.type === 'span') {
            const span: SpanEvent = {
              id: String(ev.id ?? ''),
              kind: String(ev.kind ?? 'system'),
              title: String(ev.title ?? ''),
              status: String(ev.status ?? 'running'),
              ms: typeof ev.ms === 'number' ? ev.ms : undefined,
              detail: ev.detail as Record<string, unknown> | undefined,
            };
            const idx = collectedSpans.findIndex((s) => s.id === span.id);
            if (idx >= 0) collectedSpans[idx] = span;
            else collectedSpans.push(span);
            setLiveSpans([...collectedSpans]);
          } else if (ev.type === 'result') {
            if (!runId && ev.run_id) runId = String(ev.run_id);
            collectedResult = {
              evaluated: Number(ev.evaluated ?? 0),
              promoted: Number(ev.promoted ?? 0),
              rejected: Number(ev.rejected ?? 0),
              total_ms: Number(ev.total_ms ?? 0),
              preview: ev.preview as ResultEvent['preview'],
            };
            setLiveResult(collectedResult);
          } else if (ev.type === 'error') {
            collectedError = String(ev.message ?? 'unknown error');
            setLiveError(collectedError);
          }
        }
      }
    } catch (e) {
      collectedError = errorMessage(e);
      setLiveError(collectedError);
    } finally {
      setRunning(false);
      setTimeout(() => scrollRef.current?.scrollTo({ top: 999999, behavior: 'smooth' }), 100);

      if (runId) {
        const patch: Record<string, unknown> = { trace: collectedSpans };
        if (collectedResult) {
          patch.stats = {
            evaluated: collectedResult.evaluated,
            promoted: collectedResult.promoted,
            rejected: collectedResult.rejected,
            total_ms: collectedResult.total_ms,
            preview: collectedResult.preview,
          };
        }
        if (collectedError) patch.error = collectedError;
        fetch(`/api/runs/${runId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        }).catch(() => {});

        setSelectedRunId(runId);
      }
      mutate();

      // AI summary of results
      if (collectedResult && !collectedError) {
        setSummarizing(true);
        setSummary('');
        try {
          const summaryRes = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              messages: [{
                role: 'user',
                content: `你刚刚完成了一次内容评判。结果如下：\n评判 ${collectedResult.evaluated} 条，推荐 ${collectedResult.promoted} 条，过滤 ${collectedResult.rejected} 条，耗时 ${(collectedResult.total_ms / 1000).toFixed(1)}s。\n\n推荐内容：\n${(collectedResult.preview ?? []).map(p => `- [${p.grade}] ${p.title}${p.why ? ': ' + p.why : ''}`).join('\n') || '无'}\n\n请用 2-3 句话总结这次评判的结果，评价推荐质量，给出改进建议。`,
              }],
            }),
          });
          if (summaryRes.ok && summaryRes.body) {
            const reader = summaryRes.body.getReader();
            const decoder = new TextDecoder();
            let text = '';
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const chunk = decoder.decode(value, { stream: true });
              // Parse AI SDK data stream: lines starting with 0:" are text chunks
              for (const line of chunk.split('\n')) {
                if (line.startsWith('0:')) {
                  try { text += JSON.parse(line.slice(2)); } catch { /* skip */ }
                }
              }
              setSummary(text);
            }
          }
        } catch { /* ignore summary errors */ } finally {
          setSummarizing(false);
        }
      }
    }
  }, [running, prompt, mutate]);

  // ── Resolve display data: live or selected run ──
  const displaySpans: SpanEvent[] = isLive
    ? liveSpans
    : selectedRun
      ? (selectedRun.trace as Record<string, unknown>[]).map((t) => ({
          id: String(t.id ?? ''),
          kind: String(t.kind ?? 'system'),
          title: String(t.title ?? ''),
          status: String(t.status ?? 'done'),
          ms: typeof t.ms === 'number' ? t.ms : undefined,
          detail: t.detail as Record<string, unknown> | undefined,
        }))
      : [];

  const displayResult: ResultEvent | null = isLive
    ? liveResult
    : selectedRun?.stats && typeof selectedRun.stats.evaluated === 'number'
      ? {
          evaluated: Number(selectedRun.stats.evaluated),
          promoted: Number(selectedRun.stats.promoted ?? 0),
          rejected: Number(selectedRun.stats.rejected ?? 0),
          total_ms: Number(selectedRun.stats.total_ms ?? 0),
          preview: selectedRun.stats.preview as ResultEvent['preview'],
        }
      : null;

  const displayError = isLive ? liveError : selectedRun?.error ?? null;

  // ── Convert spans/result/summary into Message[] for MessageList ──
  const displayMessages: Message[] = useMemo(() => {
    const msgs: Message[] = [];
    const hasContent = displaySpans.length > 0 || displayResult || displayError;
    if (!hasContent && !summary && !summarizing) return msgs;

    // User message
    msgs.push({ id: 'exec-user', role: 'user', content: '执行评判' });

    // Assistant message with tool invocations + summary
    const toolInvocations: ToolInvocation[] = displaySpans.map((s) => {
      const isDone = s.status === 'done' || s.status === 'failed';
      const resultContent: Record<string, unknown> = {};
      if (s.detail) Object.assign(resultContent, s.detail);
      if (s.ms != null) resultContent._ms = s.ms;
      if (s.status === 'failed') resultContent._failed = true;

      return {
        state: isDone ? 'result' as const : 'call' as const,
        toolCallId: s.id,
        toolName: s.title,
        args: { kind: s.kind, ...(s.detail ?? {}) },
        ...(isDone ? { result: resultContent } : {}),
      } as ToolInvocation;
    });

    // Build assistant content
    let content = '';
    if (displayError) {
      content += `**错误：** ${displayError}\n\n`;
    }
    if (displayResult) {
      if (displayResult.evaluated === 0) {
        content += '当前没有待评判的内容。请先在「数据源」页面配置源并执行采集。\n\n';
      } else {
        content += `评判 **${displayResult.evaluated}** 条 · 推荐 **${displayResult.promoted}** 条 · 过滤 **${displayResult.rejected}** 条 · ${(displayResult.total_ms / 1000).toFixed(1)}s\n\n`;
        if (displayResult.preview?.length) {
          for (const p of displayResult.preview) {
            content += `- **[${p.grade}]** ${p.title}${p.why ? ' — ' + p.why : ''}${p.url ? ` [↗](${p.url})` : ''}\n`;
          }
          content += '\n';
        }
      }
    }
    if (summary) {
      content += summary;
    }

    msgs.push({
      id: 'exec-assistant',
      role: 'assistant',
      content,
      toolInvocations: toolInvocations.length > 0 ? toolInvocations : undefined,
    });

    return msgs;
  }, [displaySpans, displayResult, displayError, summary, summarizing]);

  const isMessageLoading = running || summarizing;

  // ── Render ──
  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: Run history list */}
      <aside className="w-[220px] shrink-0 border-r border-[var(--border)] flex flex-col">
        <div className="p-3 border-b border-[var(--border)] flex items-center justify-between">
          <span className="font-semibold text-[13px]">执行历史</span>
          <Button size="sm" disabled={running} onClick={handleExecute}>
            {running ? '执行中…' : '执行'}
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {running && (
            <div
              className={cn(
                'px-3 py-2.5 cursor-pointer border-b border-[var(--border)] text-[12px]',
                isLive && 'bg-[var(--accent-soft)] border-l-2 border-l-[var(--accent)]',
              )}
              onClick={() => setSelectedRunId('live')}
            >
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--bolt)] animate-pulse" />
                <span className="font-medium">执行中…</span>
              </div>
            </div>
          )}
          {allRuns.map((run) => {
            const stats = run.stats as Record<string, unknown>;
            const promoted = Number(stats?.promoted ?? 0);
            const evaluated = Number(stats?.evaluated ?? 0);
            return (
              <div
                key={run.id}
                className={cn(
                  'px-3 py-2.5 cursor-pointer border-b border-[var(--border)] text-[12px] hover:bg-[var(--bg-sunk)]',
                  selectedRunId === run.id && 'bg-[var(--accent-soft)] border-l-2 border-l-[var(--accent)]',
                )}
                onClick={() => setSelectedRunId(run.id)}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className={cn(
                    'w-1.5 h-1.5 rounded-full shrink-0',
                    run.status === 'done' && 'bg-[var(--green,#16a34a)]',
                    run.status === 'running' && 'bg-[var(--bolt)] animate-pulse',
                    run.status === 'failed' && 'bg-[var(--fire)]',
                  )} />
                  <span className="font-medium text-[var(--text)]">
                    {promoted > 0 ? `${promoted}/${evaluated} 推荐` : evaluated > 0 ? `${evaluated} 条评判` : '无数据'}
                  </span>
                </div>
                <div className="text-[11px] text-[var(--text-3)] pl-3">
                  {relTime(run.started_at)}
                  {run.error && <span className="text-[var(--fire)] ml-1.5">失败</span>}
                </div>
              </div>
            );
          })}
          {allRuns.length === 0 && !running && (
            <div className="p-4 text-center text-[12px] text-[var(--text-3)]">
              暂无执行记录
            </div>
          )}
        </div>
      </aside>

      {/* Right: Prompt + Trace + Result */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Prompt section */}
        <div className="p-4 border-b border-[var(--border)] shrink-0">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-[13px]">提示词</span>
            <div className="flex gap-2">
              {editing && (
                <button
                  className="text-[11px] text-[var(--text-3)] hover:text-[var(--text)] cursor-pointer"
                  onClick={() => savePrompt(DEFAULT_PROMPT)}
                >
                  重置默认
                </button>
              )}
              {editing ? (
                <Button variant="outline" size="sm" onClick={stopEditing}>完成</Button>
              ) : (
                <Button variant="outline" size="sm" onClick={startEditing}>编辑</Button>
              )}
            </div>
          </div>
          {editing ? (
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => savePrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') stopEditing(); }}
              className="w-full h-[200px] bg-[var(--bg-sunk)] border border-[var(--border)] rounded-[6px] p-3 text-[12.5px] leading-[1.6] text-[var(--text)] resize-none font-mono outline-none focus:border-[var(--accent-line)]"
            />
          ) : (
            <div
              className="text-[12.5px] leading-[1.6] text-[var(--text-2)] font-mono whitespace-pre-wrap max-h-[120px] overflow-y-auto cursor-pointer hover:bg-[var(--bg-sunk)] rounded-[6px] p-3 transition-colors"
              onClick={startEditing}
              title="点击编辑"
            >
              {prompt.length > 200 ? prompt.slice(0, 200) + '…' : prompt}
            </div>
          )}
        </div>

        {/* Chat-style message flow — reuses MessageList from inbox */}
        <div className="chat-scroll flex-1" ref={scrollRef}>
          <MessageList
            messages={displayMessages}
            isLoading={isMessageLoading}
            emptyText={selectedRun ? '此次执行无详细记录' : '选择一条历史记录，或点击「执行」开始'}
          />
        </div>
      </div>
    </div>
  );
}
