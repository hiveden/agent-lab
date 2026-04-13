'use client';

import { useEffect, useRef } from 'react';
import type { ItemWithState } from '@/lib/types';
import type { MockTrace } from '../../traceMock';
import InlineTraceRail from './InlineTraceRail';
import { useChat } from 'ai/react';
import type { Message } from 'ai';
import { cn } from '@/lib/utils';

interface Props {
  item: ItemWithState;
  initialMessages: Message[];
  sessionId: string | null;
  onOpenTraceFromSpan: (trace: MockTrace, spanId: string | null) => void;
  onToggleTrace: () => void;
  traceOpen: boolean;
  onChatUpdate?: (messages: Message[]) => void;
}

const PRESETS = [
  { label: '和 LangChain 比?', msg: '这个 SDK 和 LangChain 比有什么优势?' },
  { label: '生产可用?', msg: '它现在生产环境靠谱吗?' },
  { label: '最近活跃度', msg: '给我看看最近的 commit 活跃度' },
];

export default function ChatView({
  item,
  initialMessages,
  sessionId,
  onOpenTraceFromSpan,
  onToggleTrace,
  traceOpen,
  onChatUpdate,
}: Props) {
  const { messages, input, handleInputChange, handleSubmit, isLoading, stop, setInput } = useChat({
    id: item.id,
    api: '/api/chat',
    initialMessages,
    body: {
      item_id: item.id,
      session_id: sessionId,
    },
    onFinish: (message) => {
      // Allow parent to sync state if needed
    },
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 999999 });
    if (onChatUpdate) {
      onChatUpdate(messages);
    }
  }, [messages, onChatUpdate]);

  function onPresetSend(msg: string) {
    setInput(msg);
    // Vercel AI SDK requires an Event object for handleSubmit, or we can use append
    const fakeEvent = { preventDefault: () => {} } as React.FormEvent<HTMLFormElement>;
    // Hack to trigger submit with the preset value
    setTimeout(() => handleSubmit(fakeEvent), 0);
  }

  return (
    <div className="flex flex-col overflow-hidden bg-[var(--bg)] min-w-0 h-full">
      <div className="px-5 pt-3 pb-2.5 border-b border-[var(--border)] bg-[var(--surface-hi)] shrink-0">
        <div className="flex items-start gap-2.5">
          <span className={cn(
            'chat-grade',
            item.grade,
          )}>
            {item.grade}
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="text-[15px] font-semibold text-[var(--text)] leading-[1.35] mb-[3px]">{item.title}</h2>
            <div className="flex gap-2.5 text-[11.5px] text-[var(--text-3)] items-center flex-wrap">
              {item.source ? <span>{item.source}</span> : null}
              {item.url ? (
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] no-underline font-[var(--mono)] text-[11px] hover:underline">
                  ↗ open
                </a>
              ) : null}
            </div>
          </div>
          <div className="flex gap-1 items-center shrink-0">
            <button
              className={cn('icon-btn w-[26px] h-[26px]', traceOpen && 'on')}
              title="Toggle trace (T)"
              onClick={onToggleTrace}
              aria-label="Toggle trace"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path d="M3 12h4l3-9 4 18 3-9h4" />
              </svg>
            </button>
          </div>
        </div>
        {item.why ? (
          <div className="mt-2.5 py-[9px] px-3 bg-[var(--surface)] border border-[var(--border)] rounded-[5px] text-xs text-[var(--text-2)] leading-[1.55] border-l-2 border-l-[var(--accent-line)]">
            <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-3)] mr-1.5 font-semibold">why</span>
            {item.why}
          </div>
        ) : null}
      </div>

      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 ? (
          <div
            style={{
              color: 'var(--text-3)',
              fontSize: 12.5,
              padding: '20px 0',
            }}
          >
            对这条推送有什么想追问的? 发一条消息试试。
          </div>
        ) : (
          messages.map((m: Message) => (
            <div
              key={m.id}
              className={`msg ${m.role}${isLoading && m.role === 'assistant' && !m.content ? ' streaming' : ''}`}
            >
              <div className="msg-meta">
                {m.role === 'user' ? 'you' : 'radar'}
                {m.role === 'assistant' && isLoading && m.id === messages[messages.length - 1].id && !m.content ? (
                  <span style={{ marginLeft: 6, color: 'var(--text-faint)' }}>
                    is thinking…
                  </span>
                ) : null}
              </div>
              <div className="msg-bubble">
                {m.content ? (
                  m.content
                ) : isLoading && m.id === messages[messages.length - 1].id ? (
                  <span className="thinking-dots" aria-label="thinking">
                    <span />
                    <span />
                    <span />
                  </span>
                ) : null}
              </div>
              {/* Note: Trace injection requires custom handling in Vercel SDK if needed. We hide it for now unless we add tool_calls mapping. */}
            </div>
          ))
        )}
      </div>

      <div className="border-t border-[var(--border)] bg-[var(--surface-hi)] px-4 pt-2.5 pb-3 shrink-0">
        <div className="flex gap-1.5 mb-2 flex-wrap">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              className="text-[11.5px] py-[3px] px-2.5 bg-[var(--surface)] border border-[var(--border-hi)] rounded-full text-[var(--text-2)] cursor-pointer transition-all duration-[.12s] hover:border-[var(--accent-line)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
              disabled={isLoading}
              onClick={() => {
                if (isLoading) return;
                onPresetSend(p.msg);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <form className="input-row" onSubmit={handleSubmit}>
          <textarea
            ref={taRef}
            rows={1}
            value={input}
            placeholder="问 Radar 一些关于这条推荐的问题…"
            onChange={(e) => {
              handleInputChange(e);
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 120) + 'px';
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const fakeEvent = { preventDefault: () => {} } as React.FormEvent<HTMLFormElement>;
                handleSubmit(fakeEvent);
              }
            }}
            disabled={isLoading}
          />
          {isLoading ? (
            <button type="button" className="send-btn" onClick={stop}>
              停止
            </button>
          ) : (
            <button
              type="submit"
              className="send-btn"
              disabled={isLoading || !input.trim()}
            >
              发送
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
