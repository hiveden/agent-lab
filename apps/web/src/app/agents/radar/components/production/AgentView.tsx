'use client';

import { useState, useCallback, useRef, useEffect, useMemo, useReducer } from 'react';
import { Group, Panel, Separator, type Layout, type PanelImperativeHandle } from 'react-resizable-panels';
import {
  CopilotKit,
  CopilotChat,
  useAgent,
  useAgentContext,
  type Message,
  type AssistantMessage,
  type ToolMessage,
} from '@copilotkit/react-core/v2';
import '@copilotkit/react-core/v2/styles.css';
import { cn } from '@/lib/utils';
import type { Trace, Span, SpanSection } from '@/lib/trace';
import TraceDrawer from '../consumption/TraceDrawer';
import MarkdownContent from '../consumption/MarkdownContent';
import ConfigCards, { buildPromptFromCards } from './ConfigCards';
import ResultsPane, { type ResultBatch } from './ResultsPane';

// ── Helpers ───────────────────────────────────────────────

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

// ── Help icon ──────────────────────────────────────────────

function HelpIcon({ tooltip }: { tooltip: string }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  const show = useCallback(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left + r.width / 2 });
  }, []);

  return (
    <span
      ref={ref}
      className="help-icon"
      onMouseEnter={show}
      onMouseLeave={() => setPos(null)}
    >
      ?
      {pos && (
        <span
          className="help-bubble"
          style={{ position: 'fixed', top: pos.top, left: pos.left, transform: 'translateX(-50%)' }}
        >
          {tooltip}
        </span>
      )}
    </span>
  );
}

// ── Chat presets ───────────────────────────────────────────

const PRESETS = [
  { label: '执行评判', msg: '帮我执行一次内容评判' },
  { label: '最近推荐质量', msg: '最近几次推荐质量怎么样？' },
  { label: '调整偏好', msg: '我最近更关注 AI Agent 架构方面的内容' },
];

// ── Extract evaluate results from AG-UI messages ──────────

function extractResultBatches(messages: Message[]): ResultBatch[] {
  const batches: ResultBatch[] = [];

  const toolResultMap = new Map<string, string>();
  for (const m of messages) {
    if (m.role === 'tool') {
      const tr = m as ToolMessage;
      toolResultMap.set(tr.toolCallId, tr.content);
    }
  }

  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    const am = m as AssistantMessage;
    if (!am.toolCalls?.length) continue;

    for (const tc of am.toolCalls) {
      if (tc.function.name !== 'evaluate') continue;

      const resultContent = toolResultMap.get(tc.id);
      if (!resultContent) continue;

      let r: Record<string, unknown>;
      try {
        r = JSON.parse(resultContent);
      } catch {
        continue;
      }

      if (r.error && !r.promoted) continue;

      batches.push({
        runId: tc.id,
        startedAt: new Date().toISOString(),
        evaluated: Number(r.evaluated ?? 0),
        promoted: Number(r.promoted ?? 0),
        rejected: Number(r.rejected ?? 0),
        totalMs: Number(r.total_ms ?? 0),
        error: r.error ? String(r.error) : null,
        preview: (r.preview as ResultBatch['preview']) ?? [],
      });
    }
  }

  return batches;
}

// ── Build Trace from AG-UI messages ───────────────────────

function buildTraceFromMessages(messages: Message[]): Trace {
  const spans: Span[] = [];

  const toolResultMap = new Map<string, ToolMessage>();
  for (const m of messages) {
    if (m.role === 'tool') {
      toolResultMap.set((m as ToolMessage).toolCallId, m as ToolMessage);
    }
  }

  for (const m of messages) {
    if (m.role === 'assistant') {
      const am = m as AssistantMessage;

      if (am.toolCalls?.length) {
        for (const tc of am.toolCalls) {
          const sections: SpanSection[] = [];

          let argsStr = tc.function.arguments;
          try {
            argsStr = JSON.stringify(JSON.parse(tc.function.arguments), null, 2);
          } catch { /* use raw string */ }
          sections.push({ label: 'input', body: argsStr });

          const result = toolResultMap.get(tc.id);
          if (result) {
            let resultStr = result.content;
            try {
              resultStr = JSON.stringify(JSON.parse(resultStr), null, 2);
            } catch { /* use raw string */ }
            sections.push({ label: 'output', body: resultStr });
          }

          spans.push({
            id: `${am.id}-${tc.id}`,
            kind: 'tool',
            tool: tc.function.name,
            title: tc.function.name,
            tokens: 0,
            ms: 0,
            sections,
            status: result ? 'done' : 'running',
          });
        }
      }

      if (am.content && typeof am.content === 'string' && am.content.trim()) {
        spans.push({
          id: `${am.id}-text`,
          kind: 'llm',
          title: '生成回复',
          tokens: 0,
          ms: 0,
          sections: [{ label: 'output', body: am.content.slice(0, 500) }],
          status: 'done',
        });
      }
    }
  }

  return { spans, totalTokens: 0, totalMs: 0, mock: false };
}

// ── Inner component (must be inside CopilotKit provider) ──

interface RadarAgentState {
  progress?: { step: string; evaluated?: number; promoted?: number; total?: number };
}

function AgentViewInner() {
  // ── Stable threadId shared between CopilotChat and useAgent ──
  const threadId = useMemo(() => crypto.randomUUID(), []);

  // ── Agent: shared state + messages + control via AbstractAgent ──
  const { agent } = useAgent({ agentId: 'radar', threadId });

  // ── Bridge: subscribe Inspector to thread clone ──
  // CopilotKit bug: Inspector only subscribes to agents in core.agents (registry),
  // but CopilotChat runs on a thread clone that's not registered there.
  // Workaround: find the Inspector web component and directly subscribe it to the clone.
  // Inspector is lazy-loaded (dynamic import), so poll briefly until it appears.
  useEffect(() => {
    if (!agent?.agentId) return;
    let attempts = 0;
    const trySubscribe = () => {
      const el = document.querySelector('cpk-web-inspector') as any;
      if (el?.subscribeToAgent) {
        el.subscribeToAgent(agent);
        return;
      }
      if (++attempts < 20) setTimeout(trySubscribe, 200);
    };
    trySubscribe();
  }, [agent]);

  const agentState = (agent.state ?? {}) as RadarAgentState;
  const messages = agent.messages;
  const isRunning = agent.isRunning;

  // ── Inject user preferences as agent context ──
  const [configVersion, bumpConfigVersion] = useReducer((x: number) => x + 1, 0);
  const userPreferences = useMemo(() => buildPromptFromCards(), [configVersion]);
  useAgentContext({
    description: '用户偏好配置（使命、推荐偏好、过滤规则、质量门槛、背景、兴趣、反感内容）',
    value: userPreferences,
  });

  // ── Panel collapse state ──
  const [configCollapsed, setConfigCollapsed] = useState(false);
  const [resultsCollapsed, setResultsCollapsed] = useState(false);
  const configPanelRef = useRef<PanelImperativeHandle>(null);
  const resultsPanelRef = useRef<PanelImperativeHandle>(null);

  // ── Results pagination ──
  const [resultPageIndex, setResultPageIndex] = useState(0);

  // ── Trace ──
  const [traceOpen, setTraceOpen] = useState(true);
  const trace: Trace = useMemo(() => buildTraceFromMessages(messages), [messages]);

  // ── Derived: result batches from tool invocations ──
  const resultBatches = useMemo(() => extractResultBatches(messages), [messages]);

  useEffect(() => {
    setResultPageIndex(0);
  }, [resultBatches.length]);

  // ── Preset send ──
  const sendPreset = useCallback((msg: string) => {
    if (isRunning) return;
    agent.addMessage({ id: crypto.randomUUID(), role: 'user', content: msg });
    agent.runAgent();
  }, [isRunning, agent]);

  // ── Collapse toggles ──
  const toggleConfig = useCallback(() => {
    const panel = configPanelRef.current;
    if (!panel) return;
    if (configCollapsed) { panel.expand(); setConfigCollapsed(false); }
    else { panel.collapse(); setConfigCollapsed(true); }
  }, [configCollapsed]);

  const toggleResults = useCallback(() => {
    const panel = resultsPanelRef.current;
    if (!panel) return;
    if (resultsCollapsed) { panel.expand(); setResultsCollapsed(false); }
    else { panel.collapse(); setResultsCollapsed(true); }
  }, [resultsCollapsed]);

  // ── Render ──
  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: Session list (placeholder — single session for now) */}
      <aside className="w-[200px] shrink-0 border-r border-border flex flex-col">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <span className="font-semibold text-[12px]">会话</span>
          <HelpIcon tooltip="每次对话为一个独立 session，避免上下文过长" />
        </div>
        <div className="flex-1 overflow-y-auto">
          <div
            className={cn(
              'px-3 py-2.5 cursor-pointer border-b border-border text-[12px]',
              'bg-accent-soft border-l-2 border-l-accent-brand',
            )}
          >
            <div className="flex items-center gap-1.5 mb-0.5">
              {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-bolt animate-pulse" />}
              <span className="font-medium text-text">
                {messages.length > 0 ? `${messages.length} 条消息` : '新会话'}
              </span>
            </div>
            <div className="text-[11px] text-text-3 pl-3">
              {agentState.progress
                ? `${agentState.progress.step} (${agentState.progress.promoted ?? 0}/${agentState.progress.total ?? '?'})`
                : messages.length > 0 ? relTime(new Date().toISOString()) : '当前'}
            </div>
          </div>
        </div>
      </aside>

      {/* Right: 3-panel vertical layout */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Group
          orientation="vertical"
          className="flex-1 min-h-0"
          defaultLayout={loadLayout('agent.layout.v2')}
          onLayoutChanged={saveLayout('agent.layout.v2')}
        >
          {/* Panel 1: Config cards (collapsible) */}
          <Panel
            id="config"
            panelRef={configPanelRef}
            defaultSize={25}
            minSize="36px"
            collapsible
            collapsedSize="36px"
            onResize={(size) => setConfigCollapsed(size.inPixels <= 40)}
          >
            <div className="h-full flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-4 py-1.5 border-b border-border shrink-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] font-semibold text-text">Agent 配置</span>
                  <HelpIcon tooltip="Agent 的推荐规则、过滤条件和用户画像配置" />
                </div>
                <button
                  className="text-[11px] text-text-3 hover:text-text cursor-pointer"
                  onClick={toggleConfig}
                >
                  {configCollapsed ? '▼ 展开' : '▲ 收起'}
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <ConfigCards onChange={bumpConfigVersion} />
              </div>
            </div>
          </Panel>

          <Separator className="drag-handle">
            <div className="drag-bar" />
          </Separator>

          {/* Panel 2: Results (collapsible) */}
          <Panel
            id="results"
            panelRef={resultsPanelRef}
            defaultSize={35}
            minSize="36px"
            collapsible
            collapsedSize="36px"
            onResize={(size) => setResultsCollapsed(size.inPixels <= 40)}
          >
            <div className="h-full flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-4 py-1.5 border-b border-border shrink-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] font-semibold text-text">推送结果</span>
                  <HelpIcon tooltip="每次评判的推荐结果，支持翻页查看历史批次" />
                </div>
                <button
                  className="text-[11px] text-text-3 hover:text-text cursor-pointer"
                  onClick={toggleResults}
                >
                  {resultsCollapsed ? '▼ 展开' : '▲ 收起'}
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <ResultsPane
                  batches={resultBatches}
                  currentIndex={resultPageIndex}
                  onNavigate={setResultPageIndex}
                  running={isRunning}
                />
              </div>
            </div>
          </Panel>

          <Separator className="drag-handle">
            <div className="drag-bar" />
          </Separator>

          {/* Panel 3: Chat + Trace (bottom) */}
          <Panel id="chat-trace" defaultSize={40} minSize={20}>
            <div className="flex flex-col h-full overflow-hidden border-t border-border">
              <Group
                orientation="horizontal"
                className="flex-1 min-h-0"
                key={traceOpen ? 'with-trace' : 'chat-only'}
                defaultLayout={traceOpen ? loadLayout('agent.layout.horizontal') : undefined}
                onLayoutChanged={traceOpen ? saveLayout('agent.layout.horizontal') : undefined}
              >
                {/* Chat */}
                <Panel id="agent-chat" defaultSize={60} minSize={30}>
                  <div className="flex flex-col h-full overflow-hidden">
                    {/* Chat header */}
                    <div className="flex items-center justify-between px-4 py-1.5 border-b border-border bg-surface-hi shrink-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] font-semibold text-text">对话</span>
                        <HelpIcon tooltip="与 Agent 对话，通过自然语言触发评判或调整偏好" />
                      </div>
                      <button
                        className={cn(
                          'inline-flex items-center justify-center w-[26px] h-[26px] rounded border border-transparent bg-transparent text-text-3 cursor-pointer transition-all duration-100 hover:text-text hover:bg-bg-sunk hover:border-border-hi',
                          traceOpen && 'text-accent-brand bg-accent-soft border-accent-line',
                        )}
                        title="Toggle trace"
                        onClick={() => setTraceOpen(!traceOpen)}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <path d="M3 12h4l3-9 4 18 3-9h4" />
                        </svg>
                      </button>
                    </div>
                    {/* Preset buttons */}
                    <div className="border-b border-border bg-surface-hi px-4 py-1.5 shrink-0">
                      <div className="flex gap-1.5 flex-wrap">
                        {PRESETS.map((p) => (
                          <button
                            key={p.label}
                            className="text-[11px] py-[2px] px-2 bg-surface border border-border-hi rounded-full text-text-2 cursor-pointer transition-all duration-[.12s] hover:border-accent-line hover:bg-accent-soft hover:text-accent-brand"
                            disabled={isRunning}
                            onClick={() => sendPreset(p.msg)}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* CopilotChat — replaces MessageList + input */}
                    <div className="flex-1 min-h-0 overflow-hidden">
                      <CopilotChat
                        agentId="radar"
                        threadId={threadId}
                        className="h-full flex flex-col"
                        labels={{
                          chatInputPlaceholder: '和 Radar 对话...',
                          welcomeMessageText: '与 Radar Agent 对话，或点击预设开始',
                        }}
                        onStop={() => agent.abortRun()}
                        messageView={{
                          className: 'px-5 pt-[18px] pb-2',
                          assistantMessage: {
                            children: ({ message, messages: msgs, isRunning: running, markdownRenderer, toolCallsView, toolbar }) => {
                              const isLatest = msgs?.[msgs.length - 1]?.id === message.id;
                              const isStreaming = running && isLatest;
                              const isEmpty = !message.content;
                              return (
                                <>
                                  <div className="msg-meta">radar</div>
                                  <div className={cn('msg-bubble assistant-bubble', isStreaming && isEmpty && 'streaming')}>
                                    {isEmpty && isStreaming ? (
                                      <span className="thinking-dots" aria-label="thinking">
                                        <span /><span /><span />
                                      </span>
                                    ) : isStreaming ? (
                                      // 流式：用 streamdown 处理增量事件，避免 content 重叠累加导致重复
                                      <div className="chat-markdown">{markdownRenderer}</div>
                                    ) : message.content ? (
                                      // 完成：用 react-markdown 全量渲染，排版更干净
                                      <MarkdownContent content={message.content} />
                                    ) : null}
                                    {toolCallsView}
                                    {toolbar}
                                  </div>
                                </>
                              );
                            },
                          },
                          userMessage: {
                            children: ({ message }) => {
                              const text = typeof message.content === 'string'
                                ? message.content
                                : Array.isArray(message.content)
                                  ? message.content.filter((p): p is { type: 'text'; text: string } => p.type === 'text').map(p => p.text).join('')
                                  : '';
                              return (
                                <>
                                  <div className="msg-meta">you</div>
                                  <div className="msg-bubble user-bubble">{text}</div>
                                </>
                              );
                            },
                          },
                        }}
                        input={{
                          textArea: { style: { fontSize: '13px' } },
                        }}
                      />
                    </div>
                  </div>
                </Panel>

                {/* Trace panel */}
                {traceOpen && (
                  <>
                    <Separator className="trace-divider" />
                    <Panel id="agent-trace" defaultSize="40%" minSize="20%" maxSize="60%">
                      <TraceDrawer
                        open={traceOpen}
                        trace={trace}
                        onClose={() => setTraceOpen(false)}
                        highlightSpanId={null}
                        expandAllSignal={0}
                        collapseAllSignal={0}
                      />
                    </Panel>
                  </>
                )}
              </Group>
            </div>
          </Panel>
        </Group>
      </div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────

export default function AgentView() {
  return (
    <CopilotKit runtimeUrl="/api/agent/chat" showDevConsole>
      <AgentViewInner />
    </CopilotKit>
  );
}
