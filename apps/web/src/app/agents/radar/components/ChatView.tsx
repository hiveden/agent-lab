'use client';

import { useEffect, useRef, useState } from 'react';
import type { ItemWithState } from '@/lib/types';
import type { MockTrace } from '../traceMock';
import InlineTraceRail from './InlineTraceRail';
import { useChat } from 'ai/react';
import type { Message } from 'ai';

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
    <div className="chat-col">
      <div className="chat-head">
        <div className="chat-head-row">
          <span className={`chat-grade ${item.grade}`}>{item.grade}</span>
          <div className="chat-title">
            <h2>{item.title}</h2>
            <div className="meta">
              {item.source ? <span>{item.source}</span> : null}
              {item.url ? (
                <a href={item.url} target="_blank" rel="noopener noreferrer">
                  ↗ open
                </a>
              ) : null}
            </div>
          </div>
          <div className="chat-head-actions">
            <button
              className={`icon-btn ${traceOpen ? 'on' : ''}`}
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
          <div className="chat-why">
            <span className="label">why</span>
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

      <div className="composer">
        <div className="preset-row">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              className="preset"
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

