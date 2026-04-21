import { useQuery } from '@tanstack/react-query';
import type { Run } from '@/lib/types';
import { swrFetcher } from './fetch-utils';

export type { Run };

export function useRuns(opts?: { phase?: string; limit?: number }) {
  const phase = opts?.phase ?? null;
  const limit = opts?.limit ?? 50;
  const params = new URLSearchParams({ agent_id: 'radar' });
  if (phase) params.set('phase', phase);
  params.set('limit', String(limit));

  const query = useQuery({
    queryKey: ['runs', 'radar', { phase, limit }],
    queryFn: () => swrFetcher<{ runs?: Run[] }>(`/api/runs?${params.toString()}`),
  });

  return {
    runs: query.data?.runs ?? [],
    isLoading: query.isLoading,
    error: query.error,
    mutate: () => query.refetch(),
  };
}
