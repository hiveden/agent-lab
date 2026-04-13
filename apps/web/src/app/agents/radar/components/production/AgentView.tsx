'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Group, Panel, Separator, type Layout } from 'react-resizable-panels';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useRuns } from '@/lib/hooks/use-runs';
import { errorMessage } from '@/lib/fetch';
import type { Message, ToolInvocation } from 'ai';
import MessageList from '../shared/MessageList';

// ── Default documents ──────────────────────────────────────

const DEFAULT_RULES = `你是 Radar，一个科技资讯策展 Agent。

## 核心使命
替代用户刷社交媒体的时间，推荐比短视频更吸引人的内容。
创意 > 准确，意外发现 > 预期内容。

## 筛选偏好
值得推：
- 独立开发者创意项目和变现故事
- CLI 工具、编辑器插件、开发者工具
- AI / Agent / LLM infra 新玩法和实践
- "我用 XX 做了 YY" 实战分享
- 技术社区热门争论和八卦

不推：
- AI 模型/论文/框架深度评测
- 大公司产品更新
- "AI 零代码做了 XX" 类内容
- 没有实际内容的炫技
- 用户已知工具（除非重大更新）

## 质量门槛
- 不确定质量时宁可不推，不凑数
- 每轮 ≤5 条
- 分级：🔥 必看（fire）· ⚡ 值得看（bolt）· 💡 备选（bulb）

## 输出格式
严格合法的 JSON 数组，不要 markdown 代码块，每个元素：
{
  "external_id_suffix": "<原始 id>",
  "grade": "fire | bolt | bulb",
  "title": "<简洁中文标题>",
  "summary": "<2-3 句话中文总结>",
  "why": "<为什么推给这位用户>",
  "tags": ["<2-4 个标签>"],
  "url": "<原 url>"
}`;

const DEFAULT_PROFILE = `## 基本信息
- 7年全栈开发经验，正在转型 AI Agent 工程师
- 技术栈：Python + React/TypeScript
- 日常工具：Claude Code、MCP Server、LangGraph

## 信息偏好
会说"卧槽"的：
- 独立开发者的创意项目和变现故事
- CLI 工具、编辑器插件、终端工作流优化
- MCP / Agent 架构的新玩法和实践
- 本地优先、自部署、隐私友好的工具
- 技术社区的热门争论和八卦

会翻白眼的：
- "AI 零代码做了 XX"（自己天天 AI coding）
- 大而全的工具列表、泛泛的推荐
- AI 模型发布/评测/论文
- 没有实际内容的炫技项目
- 已经在用的工具（除非重大更新）

## 质量门槛
- AI 重度用户，推荐门槛按高水平开发者来
- 不确定质量时宁可不推`;

// ── Document config ──────────────────────────────────────

type DocTab = 'rules' | 'profile';

const DOC_TABS: { key: DocTab; label: string; storageKey: string; default: string }[] = [
  { key: 'rules', label: 'Agent 规则', storageKey: 'agent-lab.doc-rules', default: DEFAULT_RULES },
  { key: 'profile', label: '用户画像', storageKey: 'agent-lab.doc-profile', default: DEFAULT_PROFILE },
];

function loadDoc(tab: typeof DOC_TABS[number]): string {
  if (typeof window === 'undefined') return tab.default;
  return localStorage.getItem(tab.storageKey) ?? tab.default;
}

// ── Types ──────────────────────────────────────────────────

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

// ── Layout persistence ─────────────────────────────────────

function saveLayout(key: string) {
  return (layout: Layout) => {
    try { localStorage.setItem(key, JSON.stringify(layout)); } catch { /* ignore */ }
  };
}
function loadLayout(key: string): Layout | undefined {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : undefined;
  } catch { return undefined; }
}

// ── Chat presets ───────────────────────────────────────────

const PRESETS = [
  { label: '执行评判', msg: '帮我执行一次内容评判' },
  { label: '最近推荐质量', msg: '最近几次推荐质量怎么样？' },
  { label: '调整偏好', msg: '我最近更关注 AI Agent 架构方面的内容' },
];

// ── Component ──────────────────────────────────────────────

export default function AgentView() {
  // ── Run list ──
  const { runs: allRuns, mutate } = useRuns({ phase: 'evaluate', limit: 30 });
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // ── Documents ──
  const [activeDoc, setActiveDoc] = useState<DocTab>('rules');
  const [docs, setDocs] = useState<Record<DocTab, string>>(() => ({
    rules: loadDoc(DOC_TABS[0]),
    profile: loadDoc(DOC_TABS[1]),
  }));
  const [editingDoc, setEditingDoc] = useState<DocTab | null>(null);
  const docTextareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Chat state ──
  const [chatInput, setChatInput] = useState('');
  const chatRef = useRef<HTMLTextAreaElement>(null);

  // ── Execution state ──
  const [running, setRunning] = useState(false);
  const [liveSpans, setLiveSpans] = useState<SpanEvent[]>([]);
  const [liveResult, setLiveResult] = useState<ResultEvent | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string>('');
  const [summarizing, setSummarizing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Derived ──
  const selectedRun = allRuns.find((r) => r.id === selectedRunId) ?? null;
  const isLive = running && (!selectedRunId || selectedRunId === 'live');

  useEffect(() => {
    if (!selectedRunId && allRuns.length > 0) {
      setSelectedRunId(allRuns[0].id);
    }
  }, [allRuns, selectedRunId]);

  // ── Doc helpers ──
  const updateDoc = useCallback((key: DocTab, value: string) => {
    setDocs((prev) => ({ ...prev, [key]: value }));
    const tab = DOC_TABS.find((t) => t.key === key)!;
    localStorage.setItem(tab.storageKey, value);
  }, []);

  const resetDoc = useCallback((key: DocTab) => {
    const tab = DOC_TABS.find((t) => t.key === key)!;
    updateDoc(key, tab.default);
  }, [updateDoc]);

  const startEditingDoc = useCallback((key: DocTab) => {
    setActiveDoc(key);
    setEditingDoc(key);
    setTimeout(() => docTextareaRef.current?.focus(), 0);
  }, []);

  const buildPrompt = useCallback(() => {
    return `${docs.rules}\n\n---\n\n## 用户画像\n\n${docs.profile}`;
  }, [docs]);

  // ── Execute ──
  const handleExecute = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setLiveSpans([]);
    setLiveResult(null);
    setLiveError(null);
    setSelectedRunId('live');

    const prompt = buildPrompt();
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
  }, [running, buildPrompt, mutate]);

  // ── Chat submit ──
  const handleChatSubmit = useCallback(() => {
    const msg = chatInput.trim();
    if (!msg || running) return;
    setChatInput('');
    // For now, trigger evaluate when chat mentions it
    if (msg.includes('评判') || msg.includes('执行')) {
      handleExecute();
    }
  }, [chatInput, running, handleExecute]);

  // ── Display data ──
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

  const displayMessages: Message[] = useMemo(() => {
    const msgs: Message[] = [];
    const hasContent = displaySpans.length > 0 || displayResult || displayError;
    if (!hasContent && !summary && !summarizing) return msgs;

    msgs.push({ id: 'exec-user', role: 'user', content: '执行评判' });

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

      {/* Right: Documents (top) ↔ Chat (bottom) — resizable */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Group
          orientation="vertical"
          className="flex-1 min-h-0"
          defaultLayout={loadLayout('agent.layout.vertical')}
          onLayoutChanged={saveLayout('agent.layout.vertical')}
        >
          {/* Top panel: Document tabs */}
          <Panel defaultSize={40} minSize={15}>
            <div className="h-full flex flex-col overflow-hidden">
              {/* Tab bar + actions */}
              <div className="flex items-center justify-between px-4 pt-2.5 pb-0 shrink-0">
                <div className="flex items-center gap-0.5">
                  {DOC_TABS.map((tab) => (
                    <button
                      key={tab.key}
                      className={cn(
                        'px-3 py-1.5 text-[12px] font-medium rounded-t-[6px] cursor-pointer transition-colors',
                        activeDoc === tab.key
                          ? 'text-[var(--text)] bg-[var(--bg-sunk)]'
                          : 'text-[var(--text-3)] hover:text-[var(--text-2)]',
                      )}
                      onClick={() => {
                        setActiveDoc(tab.key);
                        if (editingDoc && editingDoc !== tab.key) setEditingDoc(null);
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  {editingDoc === activeDoc && (
                    <button
                      className="text-[11px] text-[var(--text-3)] hover:text-[var(--text)] cursor-pointer"
                      onClick={() => resetDoc(activeDoc)}
                    >
                      重置默认
                    </button>
                  )}
                  {editingDoc === activeDoc ? (
                    <Button variant="outline" size="sm" onClick={() => setEditingDoc(null)}>
                      完成
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => startEditingDoc(activeDoc)}>
                      编辑
                    </Button>
                  )}
                </div>
              </div>

              {/* Document content */}
              <div className="flex-1 overflow-y-auto px-4 pt-1 pb-3">
                {editingDoc === activeDoc ? (
                  <textarea
                    ref={docTextareaRef}
                    value={docs[activeDoc]}
                    onChange={(e) => updateDoc(activeDoc, e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape') setEditingDoc(null); }}
                    className="w-full h-full min-h-[120px] bg-[var(--bg-sunk)] border border-[var(--border)] rounded-[6px] p-3 text-[12.5px] leading-[1.6] text-[var(--text)] resize-none font-mono outline-none focus:border-[var(--accent-line)]"
                  />
                ) : (
                  <div
                    className="text-[12.5px] leading-[1.6] text-[var(--text-2)] font-mono whitespace-pre-wrap cursor-pointer hover:bg-[var(--bg-sunk)] rounded-[6px] p-3 transition-colors"
                    onClick={() => startEditingDoc(activeDoc)}
                    title="点击编辑"
                  >
                    {docs[activeDoc]}
                  </div>
                )}
              </div>
            </div>
          </Panel>

          <Separator className="drag-handle">
            <div className="drag-bar" />
          </Separator>

          {/* Bottom panel: Chat messages + input */}
          <Panel defaultSize={60} minSize={25}>
            <div className="flex flex-col h-full overflow-hidden border-t border-[var(--border)]">
              {/* Messages */}
              <div className="chat-scroll flex-1" ref={scrollRef}>
                <MessageList
                  messages={displayMessages}
                  isLoading={isMessageLoading}
                  emptyText="与 Radar Agent 对话，或点击「执行」开始评判"
                />
              </div>

              {/* Chat input */}
              <div className="border-t border-[var(--border)] bg-[var(--surface-hi)] px-4 pt-2.5 pb-3 shrink-0">
                <div className="flex gap-1.5 mb-2 flex-wrap">
                  {PRESETS.map((p) => (
                    <button
                      key={p.label}
                      className="text-[11.5px] py-[3px] px-2.5 bg-[var(--surface)] border border-[var(--border-hi)] rounded-full text-[var(--text-2)] cursor-pointer transition-all duration-[.12s] hover:border-[var(--accent-line)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
                      disabled={running}
                      onClick={() => {
                        if (running) return;
                        setChatInput(p.msg);
                        if (p.msg.includes('评判') || p.msg.includes('执行')) {
                          handleExecute();
                        }
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="input-row">
                  <textarea
                    ref={chatRef}
                    rows={1}
                    value={chatInput}
                    placeholder="和 Radar 对话…"
                    onChange={(e) => {
                      setChatInput(e.target.value);
                      const el = e.currentTarget;
                      el.style.height = 'auto';
                      el.style.height = Math.min(el.scrollHeight, 120) + 'px';
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        handleChatSubmit();
                      }
                    }}
                    disabled={running}
                  />
                  <button
                    type="button"
                    className="send-btn"
                    disabled={running || !chatInput.trim()}
                    onClick={handleChatSubmit}
                  >
                    {running ? '执行中' : '发送'}
                  </button>
                </div>
              </div>
            </div>
          </Panel>
        </Group>
      </div>
    </div>
  );
}
