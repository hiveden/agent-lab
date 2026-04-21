'use client';

/**
 * MobileChatView — 手机端 item 追问 chat（Step 3 重构：走 CopilotKit v2 AG-UI）。
 *
 * 历史：原实现走 /api/chat (Edge) + 自制 fetch + SSE 解析。
 * 重构后：CopilotKit v2 useAgent → /api/agent/chat → Python LangGraph radar agent。
 *
 * Item 上下文注入策略：
 * - 当前：首条 user 消息里注入 item 信息前言（方案 A；详见 12-step-0-execution-plan 风格决策）
 * - 未来 Step 3.5：拆 `item-explainer` agent，通过 LangGraph state 注入（方案 C）
 *
 * Desktop ChatView 保持不动（`/api/chat`），Step 3.5 统一。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CopilotKit } from '@copilotkit/react-core/v2';
import '@copilotkit/react-core/v2/styles.css';
import { ArrowLeft, ArrowUp, Flame, Zap, Lightbulb } from 'lucide-react';
import type { ItemWithState } from '@/lib/types';
import { useDwellTracker } from '@/lib/hooks/useDwellTracker';
import { useChatSession } from '@/lib/hooks/useChatSession';
import { cn } from '@/lib/utils';

interface MobileChatViewProps {
  item: ItemWithState;
  onBack: () => void;
}

function GradeIcon({ grade, size = 18 }: { grade: string; size?: number }) {
  const common = { size, strokeWidth: 2 } as const;
  if (grade === 'fire') return <Flame {...common} className="text-[#ea580c]" />;
  if (grade === 'bolt') return <Zap {...common} className="text-[#ca8a04]" />;
  if (grade === 'bulb') return <Lightbulb {...common} className="text-[#0284c7]" />;
  return null;
}

// 模块级稳定引用 — ADR-9（#32 教训）。不要 inline {}/[] 进 <CopilotKit>
const EMPTY_HEADERS = Object.freeze({}) as Record<string, string>;
const EMPTY_PROPERTIES = Object.freeze({}) as Record<string, unknown>;

/**
 * 首条隐形消息：把 item 信息作为 context 前言注入给 agent。
 * UI 上通过检测这个前缀字符串把该消息从消息列表隐藏（见 visibleMessages）。
 */
const PREAMBLE_PREFIX = '[item-context] ';
function buildItemContextPreamble(item: ItemWithState): string {
  const lines: string[] = [
    '以下是本次对话涉及的内容信息：',
    `标题：${item.title}`,
  ];
  if (item.source) lines.push(`来源：${item.source}`);
  if (item.url) lines.push(`链接：${item.url}`);
  if (item.grade) lines.push(`评级：${item.grade}`);
  if (item.why) lines.push(`推荐理由：${item.why}`);
  if (item.summary) lines.push(`摘要：${item.summary}`);
  lines.push('接下来用户会提问，请结合上述内容回答。');
  return PREAMBLE_PREFIX + lines.join('\n');
}

/**
 * Provider 包装层（对外暴露）。
 * 每个 item 独立一个 CopilotKit 实例（key={item.id}），避免切换 item 时
 * 残留前一 item 的 messages / thread 状态。
 */
export default function MobileChatView(props: MobileChatViewProps) {
  return (
    <CopilotKit
      runtimeUrl="/api/agent/chat"
      enableInspector={false}
      showDevConsole={false}
      headers={EMPTY_HEADERS}
      properties={EMPTY_PROPERTIES}
    >
      <MobileChatInner {...props} />
    </CopilotKit>
  );
}

function MobileChatInner({ item, onBack }: MobileChatViewProps) {
  // thread_id = `item-<id>`，同一 item 可续聊（LangGraph checkpointer 持久化）
  const threadId = `item-${item.id}`;
  const { messages, sendMessage, isStreaming, agent } = useChatSession({
    agentId: 'radar',
    threadId,
  });

  const [input, setInput] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 隐式追踪：停留时长（保留）
  useDwellTracker(item.id);

  // 自动标记 watching（保留原语义）
  useEffect(() => {
    if (item.status === 'unread') {
      fetch(`/api/items/${item.id}/state`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'watching' }),
      }).catch(() => {});
    }
  }, [item.id, item.status]);

  // 滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 键盘弹起时高度适配（visualViewport）
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const handler = () => {
      document.documentElement.style.setProperty('--vv-height', `${vv.height}px`);
    };
    handler();
    vv.addEventListener('resize', handler);
    return () => vv.removeEventListener('resize', handler);
  }, []);

  // 过滤掉所有以 PREAMBLE_PREFIX 开头的 user 消息（context 注入，UI 不显示）
  const visibleMessages = useMemo(() => {
    if (!messages || messages.length === 0) return [];
    return messages.filter((m) => {
      const msg = m as { role?: string; content?: unknown };
      if (msg.role !== 'user') return true;
      return typeof msg.content === 'string'
        ? !msg.content.startsWith(PREAMBLE_PREFIX)
        : true;
    });
  }, [messages]);

  // 判断 thread 是否已经注入过 preamble（基于消息内容，HMR / 重访 item 后依然准确）
  const hasPreamble = useMemo(() => {
    return (messages ?? []).some((m) => {
      const msg = m as { role?: string; content?: unknown };
      return (
        msg.role === 'user' &&
        typeof msg.content === 'string' &&
        msg.content.startsWith(PREAMBLE_PREFIX)
      );
    });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setSendError(null);
    setInput('');

    try {
      // 首次发送（当前 thread 还没注入过 preamble）→ 静默 addMessage preamble（不 run）
      if (!hasPreamble) {
        agent.addMessage({
          id: `pre_${Math.random().toString(36).slice(2)}${Date.now()}`,
          role: 'user',
          content: buildItemContextPreamble(item),
        });
      }
      // 发用户真实输入并触发 run（会把 preamble + text 一起喂给 agent）
      await sendMessage(text);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : String(err));
    }
  }, [input, isStreaming, item, sendMessage, agent, hasPreamble]);

  return (
    <div className="flex flex-col h-[var(--vv-height,100dvh)] bg-[var(--surface)]">
      {/* Top bar */}
      <div className="flex items-center gap-2 py-3 px-3 border-b border-[var(--border)] shrink-0">
        <button
          className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-transparent border-none text-[var(--text)] cursor-pointer [-webkit-tap-highlight-color:transparent] active:bg-[var(--surface-hi)] transition-colors"
          onClick={onBack}
          aria-label="Back"
        >
          <ArrowLeft size={20} strokeWidth={2} />
        </button>
        <span className="text-[13px] text-[var(--text-2)] tracking-wide">
          {item.source ?? 'Radar'}
        </span>
      </div>

      {/* Item summary */}
      <div className="flex gap-3 py-3.5 px-4 border-b border-[var(--border)] shrink-0">
        <div className="shrink-0 pt-0.5">
          <GradeIcon grade={item.grade} size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14.5px] font-semibold leading-[1.4] text-[var(--text)]">
            {item.title}
          </div>
          {item.why && (
            <div className="text-[12.5px] text-[var(--text-2)] mt-1.5 leading-[1.5]">
              {item.why}
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch] p-4 flex flex-col gap-3">
        {visibleMessages.length === 0 && (
          <div className="text-[var(--text-2)] text-sm text-center py-10">
            对这篇内容有什么想问的？
          </div>
        )}
        {visibleMessages.map((m) => {
          const msg = m as { id?: string; role?: string; content?: unknown };
          const role = msg.role ?? '?';
          const contentText =
            typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
          return (
            <div
              key={msg.id ?? Math.random()}
              className={cn('flex', role === 'user' ? 'justify-end' : 'justify-start')}
            >
              <div
                className={cn(
                  'max-w-[85%] py-2.5 px-3.5 rounded-2xl text-sm leading-[1.5] break-words',
                  role === 'user' && 'bg-[var(--text)] text-[var(--surface)] rounded-br-[4px]',
                  role === 'assistant' &&
                    'bg-[var(--surface-hi)] text-[var(--text)] rounded-bl-[4px]',
                )}
              >
                {contentText}
              </div>
            </div>
          );
        })}
        {isStreaming &&
          visibleMessages[visibleMessages.length - 1]?.role === 'user' && (
            <div className="flex justify-start">
              <div className="max-w-[85%] py-2.5 px-3.5 rounded-2xl text-sm leading-[1.5] break-words bg-[var(--surface-hi)] text-[var(--text)] rounded-bl-[4px] opacity-60 italic">
                Thinking…
              </div>
            </div>
          )}
        <div ref={messagesEndRef} />
      </div>

      {sendError && (
        <div className="px-4 py-2 bg-fire-soft text-fire text-xs border-t border-fire/20 shrink-0">
          {sendError}
        </div>
      )}

      {/* Input */}
      <div className="flex items-end gap-2 py-2 px-3 border-t border-[var(--border)] bg-[var(--surface)] shrink-0 pb-[max(8px,env(safe-area-inset-bottom))]">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about this article…"
          rows={1}
          className="flex-1 border border-[var(--border)] rounded-[20px] py-2.5 px-4 text-[15px] leading-[1.4] resize-none bg-[var(--surface)] text-[var(--text)] font-inherit max-h-[120px] focus:outline-none focus:border-[var(--text)]"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <button
          className="w-9 h-9 rounded-full border-none bg-[var(--text)] text-[var(--surface)] cursor-pointer shrink-0 flex items-center justify-center disabled:opacity-30 active:scale-95 transition-transform"
          onClick={handleSend}
          disabled={isStreaming || !input.trim()}
          aria-label="Send"
        >
          <ArrowUp size={18} strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}
