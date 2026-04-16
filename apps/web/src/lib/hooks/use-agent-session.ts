import useSWR from 'swr';
import type { ResultSummary } from '@/lib/types';
import { swrFetcher, SWR_DEFAULT_OPTIONS } from './swr-utils';

export interface PersistedMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  tool_calls?: Array<{ id: string; name: string; args: Record<string, unknown> }> | null;
  tool_call_id?: string | null;
  created_at: string;
}

export interface AgentSession {
  session_id: string;
  messages: PersistedMessage[];
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
