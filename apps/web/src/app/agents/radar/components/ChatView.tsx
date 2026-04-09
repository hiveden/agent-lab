'use client';

import { useEffect, useRef, useState } from 'react';
import type { ItemWithState } from '@/lib/types';
import type { MockTrace } from '../traceMock';
import InlineTraceRail from './InlineTraceRail';

export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  pending?: boolean;
  trace?: MockTrace;
}

interface Props {
  item: ItemWithState;
  messages: ChatMsg[];
  busy: boolean;
  onSend: (text: string) => void;
  onOpenTraceFromSpan: (trace: MockTrace, spanId: string | null) => void;
  onToggleTrace: () => void;
  traceOpen: boolean;
}

const PRESETS = [
  { label: '和 LangChain 比?', msg: '这个 SDK 和 LangChain 比有什么优势?' },
  { label: '生产可用?', msg: '它现在生产环境靠谱吗?' },
  { label: '最近活跃度', msg: '给我看看最近的 commit 活跃度' },
];

export default function ChatView({
  item,
  messages,
  busy,
  onSend,
  onOpenTraceFromSpan,
  onToggleTrace,
  traceOpen,
}: Props) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 999999 });
  }, [messages]);

  function handleSend() {
    const v = input.trim();
    if (!v || busy) return;
    setInput('');
    if (taRef.current) taRef.current.style.height = 'auto';
    onSend(v);
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
          messages.map((m) => (
            <div
              key={m.id}
              className={`msg ${m.role}${m.pending ? ' streaming' : ''}`}
            >
              <div className="msg-meta">
                {m.role === 'user' ? 'you' : 'radar'}
                {m.role === 'assistant' && m.pending && !m.content ? (
                  <span style={{ marginLeft: 6, color: 'var(--text-faint)' }}>
                    is thinking…
                  </span>
                ) : null}
              </div>
              <div className="msg-bubble">
                {m.content ? (
                  m.content
                ) : m.pending ? (
                  <span className="thinking-dots" aria-label="thinking">
                    <span />
                    <span />
                    <span />
                  </span>
                ) : null}
              </div>
              {m.role === 'assistant' && m.trace ? (
                <InlineTraceRail
                  trace={m.trace}
                  onOpenSpan={(spanId) => onOpenTraceFromSpan(m.trace!, spanId)}
                />
              ) : null}
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
              disabled={busy}
              onClick={() => {
                if (busy) return;
                onSend(p.msg);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="input-row">
          <textarea
            ref={taRef}
            rows={1}
            value={input}
            placeholder="问 Radar 一些关于这条推荐的问题…"
            onChange={(e) => {
              setInput(e.target.value);
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 120) + 'px';
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={busy}
          />
          <button
            type="button"
            className="send-btn"
            disabled={busy || !input.trim()}
            onClick={handleSend}
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
