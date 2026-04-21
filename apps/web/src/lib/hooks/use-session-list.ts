import { useQuery } from '@tanstack/react-query';
import type { ResultSummary } from '@/lib/types';
import { swrFetcher } from './fetch-utils';

export interface SessionSummary {
  id: string;
  agent_id: string;
  created_at: string;
  preview: string;
  config_prompt: string | null;
  result_summary: ResultSummary | null;
}

export function useSessionList(agentId: string) {
  const query = useQuery({
    queryKey: ['chat-sessions', 'list', agentId],
    queryFn: () =>
      swrFetcher<{ sessions: SessionSummary[] }>(
        `/api/chat/sessions?agent_id=${encodeURIComponent(agentId)}`,
      ),
  });

  return {
    sessions: query.data?.sessions ?? [],
    isLoading: query.isLoading,
    error: query.error,
    reload: () => query.refetch(),
  };
}
