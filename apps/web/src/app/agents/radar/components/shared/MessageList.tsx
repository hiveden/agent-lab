'use client';

import type { Message } from 'ai';
import ToolCard from '../consumption/ToolCard';
import MarkdownContent from '../consumption/MarkdownContent';

interface Props {
  messages: Message[];
  isLoading?: boolean;
  emptyText?: string;
}

/**
 * Shared message list renderer — used by both ChatView (inbox) and AgentView (execute console).
 * Renders user/assistant bubbles with ToolCard, MarkdownContent, and thinking dots.
 */
export default function MessageList({ messages, isLoading = false, emptyText }: Props) {
  if (messages.length === 0) {
    return (
      <div style={{ color: 'var(--text-3)', fontSize: 12.5, padding: '20px 0' }}>
        {emptyText ?? '暂无消息'}
      </div>
    );
  }

  return (
    <>
      {messages.map((m) => (
        <div
          key={m.id}
          className={`msg ${m.role}${isLoading && m.role === 'assistant' && !m.content ? ' streaming' : ''}`}
        >
          <div className="msg-meta">
            {m.role === 'user' ? 'you' : 'radar'}
          </div>
          <div className="msg-bubble">
            {m.toolInvocations?.map((inv) => (
              <ToolCard key={inv.toolCallId} invocation={inv} />
            ))}
            {m.content ? (
              m.role === 'assistant' ? (
                <MarkdownContent content={m.content} />
              ) : (
                m.content
              )
            ) : isLoading && m.role === 'assistant' && !m.toolInvocations?.length ? (
              <span className="thinking-dots" aria-label="thinking">
                <span />
                <span />
                <span />
              </span>
            ) : null}
          </div>
        </div>
      ))}
      {isLoading && messages[messages.length - 1]?.role === 'user' && (
        <div className="msg assistant streaming">
          <div className="msg-meta">radar</div>
          <div className="msg-bubble">
            <span className="thinking-dots" aria-label="thinking">
              <span />
              <span />
              <span />
            </span>
          </div>
        </div>
      )}
    </>
  );
}
