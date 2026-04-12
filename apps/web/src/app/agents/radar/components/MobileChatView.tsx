'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ItemWithState } from '@/lib/types';
import type { Message } from 'ai';
import { useDwellTracker } from '@/lib/hooks/useDwellTracker';

interface MobileChatViewProps {
  item: ItemWithState;
  initialMessages: Message[];
  sessionId: string | null;
  onBack: () => void;
  onChatUpdate?: (messages: Message[]) => void;
}

function rid() {
  return 'm_' + Math.random().toString(36).slice(2, 10);
}

const GRADE_ICON: Record<string, string> = {
  fire: '🔥',
  bolt: '⚡',
  bulb: '💡',
};

export default function MobileChatView({
  item,
  initialMessages,
  sessionId,
  onBack,
  onChatUpdate,
}: MobileChatViewProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState(sessionId);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 隐式追踪：停留时长
  useDwellTracker(item.id);

  // 隐式追踪：自动 viewing 状态跃迁
  useEffect(() => {
    if (item.status === 'unread') {
      fetch(`/api/items/${item.id}/state`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'watching' }),
      }).catch(() => {});
    }
  }, [item.id, item.status]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Keyboard resize handling
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const handler = () => {
      document.documentElement.style.setProperty(
        '--vv-height',
        `${vv.height}px`,
      );
    };
    handler();
    vv.addEventListener('resize', handler);
    return () => vv.removeEventListener('resize', handler);
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    const userMsg: Message = { id: rid(), role: 'user', content: text };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: updatedMessages.map((m) => ({ role: m.role, content: m.content })),
          item_id: item.id,
          session_id: currentSessionId,
        }),
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      // Read streaming response
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';
      const assistantId = rid();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        // Parse SSE lines
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              assistantContent += delta;
              setMessages((prev) => {
                const existing = prev.find((m) => m.id === assistantId);
                if (existing) {
                  return prev.map((m) =>
                    m.id === assistantId ? { ...m, content: assistantContent } : m,
                  );
                }
                return [...prev, { id: assistantId, role: 'assistant' as const, content: assistantContent }];
              });
            }
            // Capture session_id from response headers if available
            if (parsed.session_id) {
              setCurrentSessionId(parsed.session_id);
            }
          } catch {
            // skip
          }
        }
      }

      const finalMessages = [...updatedMessages, { id: assistantId, role: 'assistant' as const, content: assistantContent }];
      setMessages(finalMessages);

      if (onChatUpdate) {
        onChatUpdate(finalMessages);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: rid(), role: 'assistant', content: '[Error: Failed to get response]' },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, messages, item.id, currentSessionId, onChatUpdate]);

  return (
    <div className="m-chat">
      {/* Top bar */}
      <div className="m-chat-header">
        <button className="m-back-btn" onClick={onBack} aria-label="Back">
          ←
        </button>
        <span className="m-chat-source">{item.source ?? 'Radar'}</span>
      </div>

      {/* Item summary */}
      <div className="m-chat-summary">
        <div className="m-chat-grade">{GRADE_ICON[item.grade] ?? '•'}</div>
        <div className="m-chat-meta">
          <div className="m-chat-title">{item.title}</div>
          {item.why && <div className="m-chat-why">{item.why}</div>}
        </div>
      </div>

      {/* Messages */}
      <div className="m-chat-messages">
        {messages.length === 0 && (
          <div className="m-chat-empty">Ask anything about this article.</div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`m-msg ${msg.role}`}>
            <div className="m-msg-bubble">{msg.content}</div>
          </div>
        ))}
        {isLoading && messages[messages.length - 1]?.role === 'user' && (
          <div className="m-msg assistant">
            <div className="m-msg-bubble thinking">Thinking…</div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="m-chat-input">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about this article…"
          rows={1}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <button
          className="m-send-btn"
          onClick={handleSend}
          disabled={isLoading || !input.trim()}
        >
          ↑
        </button>
      </div>
    </div>
  );
}
