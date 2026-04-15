'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Group, Panel, Separator, type Layout, type PanelImperativeHandle } from 'react-resizable-panels';
import {
  CopilotKit,
  useCoAgent,
  useCopilotChatInternal,
  useCopilotAction,
  useCopilotReadable,
} from '@copilotkit/react-core';
import { CopilotChat } from '@copilotkit/react-ui';
import '@copilotkit/react-ui/styles.css';
// AG-UI message types — inline to avoid pnpm strict-mode issues with transitive @ag-ui/core
interface AGUIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
interface AGUIAssistantMessage {
  id: string;
  role: 'assistant';
  content?: string;
  toolCalls?: AGUIToolCall[];
}
interface AGUIToolMessage {
  id: string;
  role: 'tool';
  content: string;
  toolCallId: string;
}
type AGUIMessage = AGUIAssistantMessage | AGUIToolMessage | { id: string; role: string; [key: string]: unknown };
import { cn } from '@/lib/utils';
import type { Trace, Span, SpanSection } from '@/lib/trace';
import TraceDrawer from '../consumption/TraceDrawer';
import ConfigCards from './ConfigCards';
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

function extractResultBatches(messages: AGUIMessage[]): ResultBatch[] {
  const batches: ResultBatch[] = [];

  const toolResultMap = new Map<string, string>();
  for (const m of messages) {
    if (m.role === 'tool') {
      const tr = m as AGUIToolMessage;
      toolResultMap.set(tr.toolCallId, tr.content);
    }
  }

  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    const am = m as AGUIAssistantMessage;
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

function buildTraceFromMessages(messages: AGUIMessage[]): Trace {
  const spans: Span[] = [];

  const toolResultMap = new Map<string, AGUIToolMessage>();
  for (const m of messages) {
    if (m.role === 'tool') {
      toolResultMap.set((m as AGUIToolMessage).toolCallId, m as AGUIToolMessage);
    }
  }

  for (const m of messages) {
    if (m.role === 'assistant') {
      const am = m as AGUIAssistantMessage;

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
  // ── CoAgent: shared state with Python LangGraph agent ──
  const { state: agentState } = useCoAgent<RadarAgentState>({
    name: 'radar',
    initialState: {},
  });

  // ── Chat: AG-UI messages + control ──
  // useCopilotChatInternal provides AG-UI format messages (with toolCalls, toolCallId)
  // needed for trace building and result extraction
  const {
    messages: ckMessages,
    isLoading,
    stopGeneration,
    sendMessage,
  } = useCopilotChatInternal();

  const messages = ckMessages as unknown as AGUIMessage[];

  // ── Context: inject agent config as readable context for the agent ──
  useCopilotReadable({
    description: '用户的推荐偏好和过滤规则配置',
    value: '用户关注: AI/Agent/LLM infra, 独立开发者故事, CLI工具. 过滤: AI论文评测, 大公司产品更新. 质量门槛: 每轮≤5条, 不确定时宁可不推.',
  });

  // ── Frontend tools: actions the agent can invoke on the frontend ──
  useCopilotAction({
    name: 'show_notification',
    description: '在前端显示一条通知消息，用于告知用户操作结果',
    parameters: [
      { name: 'message', type: 'string', description: '通知内容' },
      { name: 'type', type: 'string', description: '通知类型: success | error | info', required: false },
    ],
    handler: ({ message, type }) => {
      console.log(`[Agent Notification] ${type ?? 'info'}: ${message}`);
    },
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
    if (isLoading) return;
    sendMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content: msg,
    });
  }, [isLoading, sendMessage]);

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
      <aside className="w-[200px] shrink-0 border-r border-[var(--border)] flex flex-col">
        <div className="p-3 border-b border-[var(--border)] flex items-center justify-between">
          <span className="font-semibold text-[12px]">会话</span>
          <HelpIcon tooltip="每次对话为一个独立 session，避免上下文过长" />
        </div>
        <div className="flex-1 overflow-y-auto">
          <div
            className={cn(
              'px-3 py-2.5 cursor-pointer border-b border-[var(--border)] text-[12px]',
              'bg-[var(--accent-soft)] border-l-2 border-l-[var(--accent)]',
            )}
          >
            <div className="flex items-center gap-1.5 mb-0.5">
              {isLoading && <span className="w-1.5 h-1.5 rounded-full bg-[var(--bolt)] animate-pulse" />}
              <span className="font-medium text-[var(--text)]">
                {messages.length > 0 ? `${messages.length} 条消息` : '新会话'}
              </span>
            </div>
            <div className="text-[11px] text-[var(--text-3)] pl-3">
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
              <div className="flex items-center justify-between px-4 py-1.5 border-b border-[var(--border)] shrink-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] font-semibold text-[var(--text)]">Agent 配置</span>
                  <HelpIcon tooltip="Agent 的推荐规则、过滤条件和用户画像配置" />
                </div>
                <button
                  className="text-[11px] text-[var(--text-3)] hover:text-[var(--text)] cursor-pointer"
                  onClick={toggleConfig}
                >
                  {configCollapsed ? '▼ 展开' : '▲ 收起'}
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <ConfigCards />
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
              <div className="flex items-center justify-between px-4 py-1.5 border-b border-[var(--border)] shrink-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[12px] font-semibold text-[var(--text)]">推送结果</span>
                  <HelpIcon tooltip="每次评判的推荐结果，支持翻页查看历史批次" />
                </div>
                <button
                  className="text-[11px] text-[var(--text-3)] hover:text-[var(--text)] cursor-pointer"
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
                  running={isLoading}
                />
              </div>
            </div>
          </Panel>

          <Separator className="drag-handle">
            <div className="drag-bar" />
          </Separator>

          {/* Panel 3: Chat + Trace (bottom) */}
          <Panel id="chat-trace" defaultSize={40} minSize={20}>
            <div className="flex flex-col h-full overflow-hidden border-t border-[var(--border)]">
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
                    <div className="flex items-center justify-between px-4 py-1.5 border-b border-[var(--border)] bg-[var(--surface-hi)] shrink-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] font-semibold text-[var(--text)]">对话</span>
                        <HelpIcon tooltip="与 Agent 对话，通过自然语言触发评判或调整偏好" />
                      </div>
                      <button
                        className={cn(
                          'inline-flex items-center justify-center w-[26px] h-[26px] rounded border border-transparent bg-transparent text-[var(--text-3)] cursor-pointer transition-all duration-100 hover:text-[var(--text)] hover:bg-[var(--bg-sunk)] hover:border-[var(--border-hi)]',
                          traceOpen && 'text-[var(--accent)] bg-[var(--accent-soft)] border-[var(--accent-line)]',
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
                    <div className="border-b border-[var(--border)] bg-[var(--surface-hi)] px-4 py-1.5 shrink-0">
                      <div className="flex gap-1.5 flex-wrap">
                        {PRESETS.map((p) => (
                          <button
                            key={p.label}
                            className="text-[11px] py-[2px] px-2 bg-[var(--surface)] border border-[var(--border-hi)] rounded-full text-[var(--text-2)] cursor-pointer transition-all duration-[.12s] hover:border-[var(--accent-line)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
                            disabled={isLoading}
                            onClick={() => sendPreset(p.msg)}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* CopilotChat — replaces MessageList + input */}
                    <div className="flex-1 overflow-hidden">
                      <CopilotChat
                        className="h-full"
                        labels={{
                          placeholder: '和 Radar 对话...',
                          initial: '与 Radar Agent 对话，或点击预设开始',
                          stopGenerating: '停止',
                        }}
                        onStopGeneration={() => stopGeneration()}
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
    <CopilotKit runtimeUrl="/api/agent/chat" agent="radar">
      <AgentViewInner />
    </CopilotKit>
  );
}
