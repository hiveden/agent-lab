'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useRuns, type Run } from '@/lib/hooks/use-runs';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/fetch';

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

        {/* Trace + Result */}
        <div className="flex-1 overflow-y-auto p-4" ref={scrollRef}>
          {displaySpans.length === 0 && !displayResult && !displayError && (
            <p className="text-[var(--text-3)] text-[13px] text-center py-8">
              {selectedRun ? '此次执行无详细记录' : '选择一条历史记录，或点击"执行"开始'}
            </p>
          )}

          {/* Trace spans */}
          {displaySpans.length > 0 && (
            <div className="mb-4">
              <h3 className="text-[12px] font-semibold text-[var(--text-2)] mb-2">执行过程</h3>
              <div className="flex flex-col gap-1">
                {displaySpans.map((s) => (
                  <div key={s.id} className="flex items-start gap-2 text-[12px] py-1.5 px-2 rounded-[4px] bg-[var(--bg-sunk)]">
                    <span className={cn(
                      'w-1.5 h-1.5 rounded-full shrink-0 mt-1',
                      s.status === 'done' && 'bg-[var(--green,#16a34a)]',
                      s.status === 'running' && 'bg-[var(--bolt,#eab308)] animate-pulse',
                      s.status === 'failed' && 'bg-[var(--fire,#dc2626)]',
                    )} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[var(--text)]">{s.title}</span>
                        {s.ms != null && (
                          <span className="text-[var(--text-3)] text-[11px] shrink-0">
                            {s.ms < 1000 ? `${s.ms}ms` : `${(s.ms / 1000).toFixed(1)}s`}
                          </span>
                        )}
                      </div>
                      {s.detail ? (
                        <div className="text-[11px] text-[var(--text-3)] mt-0.5 leading-[1.5]">
                          {s.detail.prompt_preview ? <div>Prompt: {String(s.detail.prompt_preview).slice(0, 100)}…</div> : null}
                          {s.detail.response_preview ? <div>Response: {String(s.detail.response_preview).slice(0, 150)}…</div> : null}
                          {s.detail.why ? <div>{String(s.detail.why)}</div> : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error */}
          {displayError && (
            <div className="mb-4 p-3 rounded-[6px] bg-[var(--fire-bg,#fef2f2)] border border-[var(--fire,#dc2626)] text-[12.5px] text-[var(--fire,#dc2626)]">
              {displayError}
            </div>
          )}

          {/* Result */}
          {displayResult && (
            <div className="mb-4">
              <h3 className="text-[12px] font-semibold text-[var(--text-2)] mb-2">执行结果</h3>
              {displayResult.evaluated === 0 && (
                <div className="mb-3 p-3 rounded-[6px] bg-[var(--bolt-bg)] border border-[var(--bolt)] text-[12.5px] text-[var(--bolt)]">
                  当前没有待评判的内容。请先在「数据源」页面配置源并执行采集，再回来评判。
                </div>
              )}
              <div className="flex gap-3 mb-3">
                <div className="text-center px-3 py-2 bg-[var(--bg-sunk)] rounded-[6px]">
                  <div className="text-[18px] font-semibold text-[var(--text)]">{displayResult.evaluated}</div>
                  <div className="text-[11px] text-[var(--text-3)]">评判</div>
                </div>
                <div className="text-center px-3 py-2 bg-[var(--bg-sunk)] rounded-[6px]">
                  <div className="text-[18px] font-semibold text-[var(--green,#16a34a)]">{displayResult.promoted}</div>
                  <div className="text-[11px] text-[var(--text-3)]">推荐</div>
                </div>
                <div className="text-center px-3 py-2 bg-[var(--bg-sunk)] rounded-[6px]">
                  <div className="text-[18px] font-semibold text-[var(--text-2)]">{displayResult.rejected}</div>
                  <div className="text-[11px] text-[var(--text-3)]">过滤</div>
                </div>
                <div className="text-center px-3 py-2 bg-[var(--bg-sunk)] rounded-[6px]">
                  <div className="text-[18px] font-semibold text-[var(--text)]">{(displayResult.total_ms / 1000).toFixed(1)}s</div>
                  <div className="text-[11px] text-[var(--text-3)]">耗时</div>
                </div>
              </div>

              {displayResult.preview && displayResult.preview.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h4 className="text-[11.5px] font-semibold text-[var(--text-2)]">推荐内容</h4>
                  {displayResult.preview.map((item, i) => (
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
    </div>
  );
}
