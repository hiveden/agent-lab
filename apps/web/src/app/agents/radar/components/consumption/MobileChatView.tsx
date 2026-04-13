'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ItemWithState } from '@/lib/types';
import type { Message } from 'ai';
import { useDwellTracker } from '@/lib/hooks/useDwellTracker';
import { cn } from '@/lib/utils';

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
    <div className="flex flex-col h-[var(--vv-height,100dvh)] bg-[var(--ag-bg)]">
      {/* Top bar */}
      <div className="flex items-center gap-3 py-3 px-4 border-b border-[var(--ag-border)] shrink-0">
        <button className="bg-transparent border-none text-xl text-[var(--ag-text)] cursor-pointer p-1 px-2 [-webkit-tap-highlight-color:transparent]" onClick={onBack} aria-label="Back">
          ←
        </button>
        <span className="text-[13px] text-[var(--ag-text-2)]">{item.source ?? 'Radar'}</span>
      </div>

      {/* Item summary */}
      <div className="flex gap-2.5 py-3 px-4 border-b border-[var(--ag-border)] shrink-0">
        <div className="text-xl shrink-0">{GRADE_ICON[item.grade] ?? '•'}</div>
        <div>
          <div className="text-sm font-semibold leading-[1.4]">{item.title}</div>
          {item.why && <div className="text-xs text-[var(--ag-text-2)] mt-1 leading-[1.4]">{item.why}</div>}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch] p-4 flex flex-col gap-3">
        {messages.length === 0 && (
          <div className="text-[var(--ag-text-2)] text-sm text-center py-10">对这篇内容有什么想问的？</div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className={cn(
              'max-w-[85%] py-2.5 px-3.5 rounded-2xl text-sm leading-[1.5] break-words',
              msg.role === 'user' && 'bg-[var(--ag-text)] text-[var(--ag-bg)] rounded-br-[4px]',
              msg.role === 'assistant' && 'bg-[var(--ag-hover)] text-[var(--ag-text)] rounded-bl-[4px]',
            )}>
              {msg.content}
            </div>
          </div>
        ))}
        {isLoading && messages[messages.length - 1]?.role === 'user' && (
          <div className="flex justify-start">
            <div className="max-w-[85%] py-2.5 px-3.5 rounded-2xl text-sm leading-[1.5] break-words bg-[var(--ag-hover)] text-[var(--ag-text)] rounded-bl-[4px] opacity-60 italic">Thinking…</div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="flex items-end gap-2 py-2 px-3 border-t border-[var(--ag-border)] bg-[var(--ag-bg)] shrink-0 pb-[max(8px,env(safe-area-inset-bottom))]">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about this article…"
          rows={1}
          className="flex-1 border border-[var(--ag-border)] rounded-[20px] py-2.5 px-4 text-[15px] leading-[1.4] resize-none bg-[var(--ag-bg)] text-[var(--ag-text)] font-inherit max-h-[120px] focus:outline-none focus:border-[var(--ag-text)]"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <button
          className="w-9 h-9 rounded-full border-none bg-[var(--ag-text)] text-[var(--ag-bg)] text-lg cursor-pointer shrink-0 flex items-center justify-center disabled:opacity-30"
          onClick={handleSend}
          disabled={isLoading || !input.trim()}
        >
          ↑
        </button>
      </div>
    </div>
  );
}
