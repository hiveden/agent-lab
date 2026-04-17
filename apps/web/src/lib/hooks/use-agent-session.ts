import useSWR from 'swr';
import type { ResultSummary } from '@/lib/types';
import { swrFetcher, SWR_DEFAULT_OPTIONS } from './swr-utils';

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
  const key = threadId ? `/api/chat/sessions?thread_id=${encodeURIComponent(threadId)}` : null;

  const { data, error, isLoading, mutate } = useSWR<AgentSession>(
    key,
    swrFetcher,
    SWR_DEFAULT_OPTIONS,
  );

  return {
    session: data?.session_id ? data : null,
    isLoading,
    error,
    mutate,
  };
}
