import { useQuery } from '@tanstack/react-query';
import type { ResultSummary } from '@/lib/types';
import { swrFetcher } from './fetch-utils';

/**
 * Agent 会话元数据（Phase 3 A1 之后）。
 *
 * 注意：不含 messages 字段。Agent 会话的消息由 LangGraph AsyncSqliteSaver
 * checkpointer 持有，前端通过 CopilotKit MESSAGES_SNAPSHOT 恢复（`agent.messages`
 * 来自 `useAgent` hook）。本 hook 只返回元数据用于 ConfigSnapshot / ResultsPane。
 *
 * 对应后端 `lib/chat.ts` 的 `AgentSessionMeta` type。
 */
export interface AgentSession {
  session_id: string;
  config_prompt: string | null;
  result_summary: ResultSummary | null;
}

export function useAgentSession(threadId: string | null) {
  const query = useQuery({
    queryKey: ['chat-sessions', 'thread', threadId],
    queryFn: () =>
      swrFetcher<AgentSession>(
        `/api/chat/sessions?thread_id=${encodeURIComponent(threadId ?? '')}`,
      ),
    enabled: !!threadId,
  });

  // 保持原 SWR 版语义：只有拿到 session_id 才返回 session 对象
  const session = query.data?.session_id ? query.data : null;

  return {
    session,
    isLoading: query.isLoading,
    error: query.error,
    mutate: () => query.refetch(),
  };
}
