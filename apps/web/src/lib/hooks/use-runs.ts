import useSWR from 'swr';
import type { Run } from '@/lib/types';
import { swrFetcher, SWR_DEFAULT_OPTIONS } from './swr-utils';

export type { Run };

export function useRuns(opts?: { phase?: string; limit?: number }) {
  const params = new URLSearchParams({ agent_id: 'radar' });
  if (opts?.phase) params.set('phase', opts.phase);
  params.set('limit', String(opts?.limit ?? 50));

  const { data, error, isLoading, mutate } = useSWR<{ runs?: Run[] }>(
    `/api/runs?${params.toString()}`,
    swrFetcher,
    SWR_DEFAULT_OPTIONS,
  );

  return {
    runs: data?.runs ?? [],
    isLoading,
    error,
    mutate,
  };
}
