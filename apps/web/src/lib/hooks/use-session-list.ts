import useSWR from 'swr';
import type { ResultSummary } from '@/lib/types';
import { swrFetcher, SWR_DEFAULT_OPTIONS } from './swr-utils';

export interface SessionSummary {
  id: string;
  agent_id: string;
  created_at: string;
  message_count: number;
  preview: string;
  config_prompt: string | null;
  result_summary: ResultSummary | null;
}

export function useSessionList(agentId: string) {
  const { data, error, isLoading, mutate } = useSWR<{ sessions: SessionSummary[] }>(
    `/api/chat/sessions?agent_id=${encodeURIComponent(agentId)}`,
    swrFetcher,
    SWR_DEFAULT_OPTIONS,
  );

  return {
    sessions: data?.sessions ?? [],
    isLoading,
    error,
    reload: mutate,
  };
}
