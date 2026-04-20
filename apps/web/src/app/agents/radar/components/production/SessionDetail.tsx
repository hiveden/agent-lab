'use client';

import { useState, useCallback, useRef, useEffect, useMemo, useReducer } from 'react';
import { Group, Panel, Separator, type Layout, type PanelImperativeHandle } from 'react-resizable-panels';
import {
  CopilotChat,
  useAgent,
  useAgentContext,
  useCopilotKit,
  type Message,
  type AssistantMessage,
  type ToolMessage,
} from '@copilotkit/react-core/v2';
import { cn } from '@/lib/utils';
import type { Trace, Span, SpanSection } from '@/lib/trace';
import { useAgentSession } from '@/lib/hooks/use-agent-session';
import TraceDrawer from '../consumption/TraceDrawer';
import MarkdownContent from '../consumption/MarkdownContent';
import ConfigCards, { buildPromptFromCards } from './ConfigCards';
import ConfigSnapshot from './ConfigSnapshot';
import ResultsPane, { type ResultBatch } from './ResultsPane';
import TraceLinkChip from './TraceLinkChip';

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

      // 兼容新结构 ({promoted: [...], rejected: [...]}) 和旧结构 (array → 都当 promoted)
      const rawPreview = r.preview as unknown;
      let preview: ResultBatch['preview'];
      if (Array.isArray(rawPreview)) {
        preview = { promoted: rawPreview as ResultBatch['preview']['promoted'], rejected: [] };
      } else if (rawPreview && typeof rawPreview === 'object') {
        const p = rawPreview as Partial<ResultBatch['preview']>;
        preview = {
          promoted: p.promoted ?? [],
          rejected: p.rejected ?? [],
        };
      } else {
        preview = { promoted: [], rejected: [] };
      }

      batches.push({
        runId: tc.id,
        startedAt: new Date().toISOString(),
        evaluated: Number(r.evaluated ?? 0),
        promoted: Number(r.promoted ?? 0),
        rejected: Number(r.rejected ?? 0),
        totalMs: Number(r.total_ms ?? 0),
        error: r.error ? String(r.error) : null,
        preview,
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

// ── Props ─────────────────────────────────────────────────

interface RadarAgentState {
  progress?: { step: string; evaluated?: number; promoted?: number; total?: number };
}

interface SessionDetailProps {
  threadId: string;
  isActiveSession: boolean;
  sessionReload: () => void;
  sessionMutate: () => void;
}

// ── Component ─────────────────────────────────────────────

export default function SessionDetail({ threadId, isActiveSession, sessionReload, sessionMutate }: SessionDetailProps) {
  // ── Agent: shared state + messages + control via AbstractAgent ──
  const { agent } = useAgent({ agentId: 'radar', threadId });

  // ── Session data ──
  const { session } = useAgentSession(threadId);

  // Note: Inspector DOM bridge workaround removed after upgrading to
  // CopilotKit v1.56.2 (PR #3872). The web inspector now auto-subscribes
  // to per-thread agent clones via the onAgentRunStarted event.

  const agentState = (agent.state ?? {}) as RadarAgentState;
  const messages = agent.messages;
  const isRunning = agent.isRunning;

  // ── #32 DEBUG: 全事件订阅 + setMessages 劫持 ──
  // 目标: 定位 RUN_FINISHED 后 agent.messages 被谁清空的副作用
  useEffect(() => {
    if (!agent) return;
    const agentAny = agent as unknown as {
      messages: unknown[];
      setMessages: (m: unknown[]) => void;
      addMessage: (m: unknown) => void;
      constructor: { name: string };
      __dbgPatched?: boolean;
    };
    const tag = `[DBG32 ${agentAny.constructor.name}@${(agent as { threadId?: string }).threadId ?? 'noTid'}]`;

    // 1) 订阅 agent 事件
    const sub = agent.subscribe({
      onRunStartedEvent: ({ event }) => {
        // eslint-disable-next-line no-console
        console.log(`${tag} RUN_STARTED len=${agentAny.messages.length}`, { runId: event.runId, threadId: event.threadId });
      },
      onRunFinishedEvent: ({ event }) => {
        // eslint-disable-next-line no-console
        console.log(`${tag} RUN_FINISHED len=${agentAny.messages.length}`, { runId: event.runId });
      },
      onRunErrorEvent: ({ event }) => {
        // eslint-disable-next-line no-console
        console.log(`${tag} RUN_ERROR`, event);
      },
      onMessagesChanged: () => {
        // eslint-disable-next-line no-console
        console.log(`${tag} onMessagesChanged len=${agentAny.messages.length} ids=${JSON.stringify(agentAny.messages.map((m: { id?: string }) => m.id?.slice(0,8)))}`);
      },
      onNewMessage: ({ message }) => {
        const m = message as { id?: string; role?: string; content?: unknown };
        // eslint-disable-next-line no-console
        console.log(`${tag} NewMessage role=${m.role} id=${m.id?.slice(0,8)} content=${typeof m.content === 'string' ? m.content.slice(0, 40) : JSON.stringify(m.content).slice(0, 40)}`);
      },
    });

    // 2) Hook agent.setMessages 捕获调用栈（任何清空都从这里过）
    if (!agentAny.__dbgPatched) {
      const origSet = agentAny.setMessages.bind(agent);
      agentAny.setMessages = (m: unknown[]) => {
        const stack = new Error('trace').stack?.split('\n').slice(1, 7).join('\n');
        // eslint-disable-next-line no-console
        console.log(`${tag} setMessages len=${(m ?? []).length} (was ${agentAny.messages.length})\n${stack}`);
        return origSet(m);
      };
      const origAdd = agentAny.addMessage.bind(agent);
      agentAny.addMessage = (m: unknown) => {
        const msg = m as { id?: string; role?: string };
        // eslint-disable-next-line no-console
        console.log(`${tag} addMessage role=${msg.role} id=${msg.id?.slice(0,8)} (len was ${agentAny.messages.length})`);
        return origAdd(m);
      };
      agentAny.__dbgPatched = true;
    }

    // eslint-disable-next-line no-console
    console.log(`[DBG32-chat-in agent identity] ref=${(agent as { agentId?: string }).agentId} tid=${(agent as { threadId?: string }).threadId?.slice(0, 8)} msgs=${agentAny.messages.length}`);
    // eslint-disable-next-line no-console
    console.log(`${tag} subscribed (init len=${agentAny.messages.length})`);

    // Patch clone.subscribe 看谁订阅
    const agentAny2 = agent as unknown as {
      subscribe: (s: unknown) => { unsubscribe: () => void };
      __dbgCloneSubPatched?: boolean;
    };
    if (!agentAny2.__dbgCloneSubPatched) {
      const orig = agentAny2.subscribe.bind(agent);
      agentAny2.subscribe = (s: unknown) => {
        const handlers = Object.keys(s as Record<string, unknown>);
        // eslint-disable-next-line no-console
        console.log(`[DBG32-clone-subscribe] handlers=${JSON.stringify(handlers.slice(0, 6))}${handlers.length > 6 ? '...+' + (handlers.length - 6) : ''}`);
        return orig(s);
      };
      agentAny2.__dbgCloneSubPatched = true;
    }

    // 2s 后打印 clone + master 的 subscribers 数量，看 Inspector 订阅谁
    const probeT = setTimeout(() => {
      const agentWithSubs = agent as unknown as { subscribers?: unknown[] };
      // eslint-disable-next-line no-console
      console.log(`[DBG32-subs] clone.subscribers.length=${agentWithSubs.subscribers?.length}`);
    }, 2000);
    return () => {
      clearTimeout(probeT);
      sub.unsubscribe();
    };
  }, [agent]);

  // DEBUG: isActiveSession 变化追踪
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log(`[DBG32] isActiveSession=${isActiveSession} threadId=${threadId}`);
  }, [isActiveSession, threadId]);

  // ── Restore history for read-only sessions via connectAgent ──
  // Active sessions: <CopilotChat /> calls connectAgent() on mount (see
  //   node_modules/@copilotkit/react-core/src/v2/components/chat/CopilotChat.tsx:194),
  //   which triggers ag-ui-langgraph to emit MESSAGES_SNAPSHOT from the
  //   AsyncSqliteSaver checkpointer — agent.messages gets populated automatically.
  // Historical sessions: we render a read-only message list (no CopilotChat),
  //   so connectAgent is never called → messages stay empty. Call it manually.
  const { copilotkit } = useCopilotKit();
  useEffect(() => {
    if (isActiveSession) return; // active: CopilotChat handles it
    if (!agent) return;
    let detached = false;
    void copilotkit.connectAgent({ agent }).catch((err) => {
      if (detached) return;
      console.error('SessionDetail: connectAgent (history) failed', err);
    });
    return () => { detached = true; };
  }, [isActiveSession, agent, copilotkit]);

  // DEBUG #32: runtime status + agents registry poll
  useEffect(() => {
    const ck = copilotkit as unknown as {
      runtimeConnectionStatus?: string;
      agents?: Record<string, { agentId?: string; constructor: { name: string }; threadId?: string; messages?: unknown[] }>;
      runtimeUrl?: string;
      subscribe?: (s: unknown) => { unsubscribe: () => void };
    };
    const dump = (tag: string) => {
      const ids = Object.keys(ck.agents ?? {});
      const details = ids.map((id) => {
        const a = ck.agents?.[id] as unknown as { agentId?: string; constructor: { name: string }; threadId?: string; messages?: unknown[]; subscribers?: unknown[] };
        return `${id}:${a?.constructor?.name}(msgs=${a?.messages?.length ?? '?'},subs=${a?.subscribers?.length ?? '?'},tid=${a?.threadId?.slice(0,8) ?? 'none'})`;
      }).join(',');
      // eslint-disable-next-line no-console
      console.log(`[DBG32-rt ${tag}] status=${ck.runtimeConnectionStatus} agents=[${details}]`);
    };
    dump('init');

    // Patch copilotkit.runAgent 打输入（CopilotChat 调用路径）
    const coreAny = copilotkit as unknown as {
      runAgent?: (arg: { agent: { agentId?: string; threadId?: string; messages?: unknown[] } }) => unknown;
      __dbgRunAgentPatched?: boolean;
    };
    if (!coreAny.__dbgRunAgentPatched && typeof coreAny.runAgent === 'function') {
      const origRunAgent = coreAny.runAgent.bind(copilotkit);
      coreAny.runAgent = (arg) => {
        const a = arg.agent;
        // eslint-disable-next-line no-console
        console.log(`[DBG32-chat-out copilotkit.runAgent] agent.agentId=${a.agentId} tid=${a.threadId?.slice(0,8)} msgs=${a.messages?.length}`);
        return origRunAgent(arg);
      };
      coreAny.__dbgRunAgentPatched = true;
    }

    // 订阅 master radar 的 messages 变化 + patch subscribe 跟踪所有订阅者
    let masterSub: { unsubscribe: () => void } | undefined;
    const pollMaster = setInterval(() => {
      const master = ck.agents?.radar as unknown as {
        subscribe?: (s: unknown) => { unsubscribe: () => void };
        messages?: unknown[];
        threadId?: string;
        __dbgPatched?: boolean;
      } | undefined;
      if (master && !masterSub && typeof master.subscribe === 'function') {
        // Patch master.subscribe 看谁订阅
        if (!master.__dbgPatched) {
          const orig = master.subscribe.bind(master);
          master.subscribe = (s: unknown) => {
            const handlers = Object.keys(s as Record<string, unknown>);
            // eslint-disable-next-line no-console
            console.log(`[DBG32-master-subscribe] handlers=${JSON.stringify(handlers)}`);
            return orig(s);
          };
          master.__dbgPatched = true;
        }
        masterSub = master.subscribe({
          onMessagesChanged: () => {
            // eslint-disable-next-line no-console
            console.log(`[DBG32-master onMessagesChanged] msgs=${master.messages?.length} tid=${master.threadId}`);
          },
        });
        // eslint-disable-next-line no-console
        console.log(`[DBG32-master] subscribed (init msgs=${master.messages?.length}, tid=${master.threadId})`);
        clearInterval(pollMaster);
      }
    }, 500);

    // 订阅 copilotkit 层事件看 onAgentRunStarted 传的是谁
    const ckSub = ck.subscribe?.({
      onAgentRunStarted: ({ agent: a }: { agent: { agentId?: string; constructor: { name: string }; threadId?: string; messages?: unknown[] } }) => {
        // eslint-disable-next-line no-console
        console.log(`[DBG32-core onAgentRunStarted] ${a.constructor.name} agentId=${a.agentId} tid=${a.threadId} msgs=${a.messages?.length ?? '?'}`);
      },
      onAgentRunFinished: ({ agent: a }: { agent: { agentId?: string; constructor: { name: string }; threadId?: string; messages?: unknown[] } }) => {
        // eslint-disable-next-line no-console
        console.log(`[DBG32-core onAgentRunFinished] ${a.constructor.name} agentId=${a.agentId} tid=${a.threadId} msgs=${a.messages?.length ?? '?'}`);
      },
    });

    const t = setInterval(() => dump('poll'), 2000);
    return () => {
      clearInterval(t);
      clearInterval(pollMaster);
      ckSub?.unsubscribe();
      masterSub?.unsubscribe();
    };
  }, [copilotkit]);

  // ── Refresh session list when agent run finishes ──
  // ⚠️ #32 未解：此处 1s 后 sessionReload + sessionMutate 会引起 Inspector
  // Agent tab 里 messages 被清空（人工验证 setTimeout=5000 时消失推迟 5s）。
  // 根因路径: SWR mutate → re-render → CopilotKit onAgentsChanged emit →
  //   Inspector processAgentsChanged → subscribeToAgent(master) 覆盖 clone 订阅。
  // "SWR mutate → onAgentsChanged" 的精确链路未定位。临时接受该副作用。
  const prevRunning = useRef(false);
  useEffect(() => {
    if (prevRunning.current && !isRunning) {
      setTimeout(() => {
        sessionReload();
        sessionMutate();
      }, 1000);
    }
    prevRunning.current = isRunning;
  }, [isRunning, sessionReload, sessionMutate]);

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

  // ── Derived: trace & result batches ──
  // Both active and historical sessions source from agent.messages — CopilotKit
  // populates messages via MESSAGES_SNAPSHOT on connect (from the AsyncSqliteSaver
  // checkpointer) regardless of whether the user sends a new message.
  const trace: Trace = useMemo(() => buildTraceFromMessages(messages), [messages]);

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
    <div className="flex-1 flex flex-col overflow-hidden min-w-0">
      <Group
        orientation="vertical"
        className="flex-1 min-h-0"
        defaultLayout={loadLayout('agent.layout.v2')}
        onLayoutChanged={saveLayout('agent.layout.v2')}
      >
        {/* Panel 1: Config (editable or snapshot) */}
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
                <span className="text-[12px] font-semibold text-text">
                  {isActiveSession ? 'Agent 配置' : '配置快照'}
                </span>
                {isActiveSession && (
                  <HelpIcon tooltip="Agent 的推荐规则、过滤条件和用户画像配置" />
                )}
              </div>
              <button
                className="text-[11px] text-text-3 hover:text-text cursor-pointer"
                onClick={toggleConfig}
              >
                {configCollapsed ? '▼ 展开' : '▲ 收起'}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {isActiveSession ? (
                <ConfigCards onChange={bumpConfigVersion} />
              ) : (
                <ConfigSnapshot prompt={session?.config_prompt ?? null} />
              )}
            </div>
          </div>
        </Panel>

        <Separator className="drag-handle">
          <div className="drag-bar" />
        </Separator>

        {/* Panel 2: Results */}
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
                running={isActiveSession && isRunning}
              />
            </div>
          </div>
        </Panel>

        <Separator className="drag-handle">
          <div className="drag-bar" />
        </Separator>

        {/* Panel 3: Chat + Trace */}
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
                      {!isActiveSession && (
                        <span className="text-[10px] text-text-3 ml-1">(只读)</span>
                      )}
                      <span className="ml-2"><TraceLinkChip /></span>
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

                  {/* Preset buttons — only for active session */}
                  {isActiveSession && (
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
                  )}

                  {/* Chat area */}
                  <div className="flex-1 min-h-0 overflow-hidden">
                    {isActiveSession ? (
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
                                      <div className="chat-markdown">{markdownRenderer}</div>
                                    ) : message.content ? (
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
                          sendButton: {
                            children: isRunning ? '停止' : '发送',
                          },
                        }}
                      />
                    ) : (
                      /* Historical: read-only message list, driven by agent.messages
                         which CopilotKit populates via MESSAGES_SNAPSHOT from the
                         AsyncSqliteSaver checkpointer on connect. */
                      <div className="flex-1 overflow-y-auto px-5 pt-[18px] pb-2">
                        {messages
                          .filter(m => (m.role === 'user' || m.role === 'assistant'))
                          .map(m => {
                            const content = typeof m.content === 'string'
                              ? m.content
                              : Array.isArray(m.content)
                                ? m.content.filter((p): p is { type: 'text'; text: string } => p.type === 'text').map(p => p.text).join('')
                                : '';
                            if (!content) return null;
                            return (
                              <div key={m.id}>
                                <div className="msg-meta">{m.role === 'user' ? 'you' : 'radar'}</div>
                                <div className={cn('msg-bubble', m.role === 'user' ? 'user-bubble' : 'assistant-bubble')}>
                                  {m.role === 'assistant' ? <MarkdownContent content={content} /> : content}
                                </div>
                              </div>
                            );
                          })}
                        {messages.filter(m => (m.role === 'user' || m.role === 'assistant')).length === 0 && (
                          <div className="text-[12px] text-text-3 text-center py-8">
                            {session ? '正在恢复会话…' : '无对话记录'}
                          </div>
                        )}
                      </div>
                    )}
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
  );
}
