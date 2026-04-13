'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import type { Run } from '@/lib/hooks/use-runs';

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

export default function AgentView() {
  const [prompt, setPrompt] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('agent-lab.agent-prompt') ?? DEFAULT_PROMPT;
    }
    return DEFAULT_PROMPT;
  });
  const [running, setRunning] = useState(false);
  const [spans, setSpans] = useState<SpanEvent[]>([]);
  const [result, setResult] = useState<ResultEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Restore latest evaluate run from DB on mount
  useEffect(() => {
    let cancelled = false;
    fetch('/api/runs?agent_id=radar&phase=evaluate&limit=1')
      .then((r) => (r.ok ? (r.json() as Promise<{ runs?: Run[] }>) : null))
      .then((data) => {
        if (cancelled || !data?.runs?.length) return;
        const run = data.runs[0];
        setLastRunId(run.id);

        // Restore trace → spans
        if (Array.isArray(run.trace) && run.trace.length > 0) {
          setSpans(
            (run.trace as Record<string, unknown>[]).map((t) => ({
              id: String(t.id ?? ''),
              kind: String(t.kind ?? 'system'),
              title: String(t.title ?? ''),
              status: String(t.status ?? 'done'),
              ms: typeof t.ms === 'number' ? t.ms : undefined,
              detail: t.detail as Record<string, unknown> | undefined,
            })),
          );
        }

        // Restore stats → result
        const s = run.stats;
        if (s && typeof s.evaluated === 'number') {
          setResult({
            evaluated: Number(s.evaluated),
            promoted: Number(s.promoted ?? 0),
            rejected: Number(s.rejected ?? 0),
            total_ms: Number(s.total_ms ?? 0),
            preview: s.preview as ResultEvent['preview'],
          });
        }

        // Restore error
        if (run.error) setError(run.error);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const savePrompt = useCallback((value: string) => {
    setPrompt(value);
    localStorage.setItem('agent-lab.agent-prompt', value);
  }, []);

  const handleExecute = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setSpans([]);
    setResult(null);
    setError(null);

    // Mutable accumulators for persisting after SSE completes
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
        setError(`HTTP ${res.status}`);
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
          try {
            ev = JSON.parse(data);
          } catch {
            continue;
          }

          // Capture run_id from start event
          if (ev.type === 'start' && ev.run_id) {
            runId = String(ev.run_id);
            setLastRunId(runId);
          } else if (ev.type === 'span') {
            const span: SpanEvent = {
              id: String(ev.id ?? ''),
              kind: String(ev.kind ?? 'system'),
              title: String(ev.title ?? ''),
              status: String(ev.status ?? 'running'),
              ms: typeof ev.ms === 'number' ? ev.ms : undefined,
              detail: ev.detail as Record<string, unknown> | undefined,
            };
            const existIdx = collectedSpans.findIndex((s) => s.id === span.id);
            if (existIdx >= 0) collectedSpans[existIdx] = span;
            else collectedSpans.push(span);
            setSpans([...collectedSpans]);
          } else if (ev.type === 'result') {
            if (!runId && ev.run_id) {
              runId = String(ev.run_id);
              setLastRunId(runId);
            }
            collectedResult = {
              evaluated: Number(ev.evaluated ?? 0),
              promoted: Number(ev.promoted ?? 0),
              rejected: Number(ev.rejected ?? 0),
              total_ms: Number(ev.total_ms ?? 0),
              preview: ev.preview as ResultEvent['preview'],
            };
            setResult(collectedResult);
          } else if (ev.type === 'error') {
            collectedError = String(ev.message ?? 'unknown error');
            setError(collectedError);
          }
        }
      }
    } catch (e) {
      collectedError = String(e);
      setError(collectedError);
    } finally {
      setRunning(false);
      setTimeout(() => scrollRef.current?.scrollTo({ top: 999999, behavior: 'smooth' }), 100);

      // Persist trace + enriched stats to run record
      if (runId) {
        const patch: Record<string, unknown> = {
          trace: collectedSpans,
        };
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
      }
    }
  }, [running, prompt]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Prompt editor — takes full height when no results */}
      <div className="p-4 flex flex-col h-[35%] shrink-0 border-b border-[var(--border)]">
        <div className="flex items-center justify-between mb-2 shrink-0">
          <span className="font-semibold text-[13px]">提示词</span>
          <div className="flex gap-2">
            <button
              className="text-[11px] text-[var(--text-3)] hover:text-[var(--text)] cursor-pointer"
              onClick={() => savePrompt(DEFAULT_PROMPT)}
            >
              重置默认
            </button>
            <button
              className="trigger-btn"
              disabled={running || !prompt.trim()}
              onClick={handleExecute}
            >
              {running ? '执行中…' : '执行'}
            </button>
          </div>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => savePrompt(e.target.value)}
          className="w-full flex-1 bg-[var(--bg-sunk)] border border-[var(--border)] rounded-[6px] p-3 text-[12.5px] leading-[1.6] text-[var(--text)] resize-none font-mono outline-none focus:border-[var(--accent-line)]"
          placeholder="输入你的关注偏好、过滤标准、摘要要求…"
        />
      </div>

      {/* Execution trace + results */}
      <div className="flex-1 overflow-y-auto p-4" ref={scrollRef}>
        {spans.length === 0 && !result && !error && (
          <p className="text-[var(--text-3)] text-[13px] text-center py-8">
            编辑提示词，点击"执行"查看 Agent 处理过程
          </p>
        )}

        {/* Trace spans */}
        {spans.length > 0 && (
          <div className="mb-4">
            <h3 className="text-[12px] font-semibold text-[var(--text-2)] mb-2">执行过程</h3>
            <div className="flex flex-col gap-1">
              {spans.map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-[12px] py-1.5 px-2 rounded-[4px] bg-[var(--bg-sunk)]">
                  <span className={cn(
                    'w-1.5 h-1.5 rounded-full shrink-0',
                    s.status === 'done' && 'bg-[var(--green,#16a34a)]',
                    s.status === 'running' && 'bg-[var(--bolt,#eab308)] animate-pulse',
                    s.status === 'failed' && 'bg-[var(--fire,#dc2626)]',
                  )} />
                  <span className="text-[var(--text)] flex-1">{s.title}</span>
                  {s.ms != null && (
                    <span className="text-[var(--text-3)] text-[11px] shrink-0">
                      {s.ms < 1000 ? `${s.ms}ms` : `${(s.ms / 1000).toFixed(1)}s`}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 rounded-[6px] bg-[var(--fire-bg,#fef2f2)] border border-[var(--fire,#dc2626)] text-[12.5px] text-[var(--fire,#dc2626)]">
            {error}
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="mb-4">
            <h3 className="text-[12px] font-semibold text-[var(--text-2)] mb-2">执行结果</h3>
            {result.evaluated === 0 && (
              <div className="mb-3 p-3 rounded-[6px] bg-[var(--bolt-bg)] border border-[var(--bolt)] text-[12.5px] text-[var(--bolt)]">
                当前没有待评判的内容。请先在「数据源」页面配置源并执行采集，再回来评判。
              </div>
            )}
            <div className="flex gap-3 mb-3">
              <div className="text-center px-3 py-2 bg-[var(--bg-sunk)] rounded-[6px]">
                <div className="text-[18px] font-semibold text-[var(--text)]">{result.evaluated}</div>
                <div className="text-[11px] text-[var(--text-3)]">评判</div>
              </div>
              <div className="text-center px-3 py-2 bg-[var(--bg-sunk)] rounded-[6px]">
                <div className="text-[18px] font-semibold text-[var(--green,#16a34a)]">{result.promoted}</div>
                <div className="text-[11px] text-[var(--text-3)]">推荐</div>
              </div>
              <div className="text-center px-3 py-2 bg-[var(--bg-sunk)] rounded-[6px]">
                <div className="text-[18px] font-semibold text-[var(--text-2)]">{result.rejected}</div>
                <div className="text-[11px] text-[var(--text-3)]">过滤</div>
              </div>
              <div className="text-center px-3 py-2 bg-[var(--bg-sunk)] rounded-[6px]">
                <div className="text-[18px] font-semibold text-[var(--text)]">{(result.total_ms / 1000).toFixed(1)}s</div>
                <div className="text-[11px] text-[var(--text-3)]">耗时</div>
              </div>
            </div>

            {/* Preview items */}
            {result.preview && result.preview.length > 0 && (
              <div className="flex flex-col gap-2">
                <h4 className="text-[11.5px] font-semibold text-[var(--text-2)]">推荐内容</h4>
                {result.preview.map((item, i) => (
                  <div key={i} className="border border-[var(--border)] rounded-[6px] p-3 bg-[var(--surface)]">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn(
                        'text-[10px] px-1.5 py-0 rounded font-medium',
                        item.grade === 'fire' && 'bg-[var(--fire-bg)] text-[var(--fire)]',
                        item.grade === 'bolt' && 'bg-[var(--bolt-bg)] text-[var(--bolt)]',
                        item.grade === 'bulb' && 'bg-[var(--bulb-bg)] text-[var(--bulb)]',
                      )}>
                        {item.grade}
                      </span>
                      <span className="text-[13px] font-medium text-[var(--text)] flex-1">{item.title}</span>
                      {item.url && (
                        <a href={item.url} target="_blank" rel="noopener noreferrer"
                          className="text-[var(--accent)] text-[11px] shrink-0 hover:underline">↗</a>
                      )}
                    </div>
                    {item.why && (
                      <div className="text-[12px] text-[var(--text-2)] leading-[1.5]">{item.why}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
