import useSWR from 'swr';

export interface Run {
  id: string;
  agent_id: string;
  phase: string;
  status: string;
  source_ids: string[];
  stats: Record<string, unknown>;
  trace: unknown[];
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

const fetcher = (url: string) => fetch(url).then((r) => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<{ runs?: Run[] }>;
});

export function useRuns(opts?: { phase?: string; limit?: number }) {
  const params = new URLSearchParams({ agent_id: 'radar' });
  if (opts?.phase) params.set('phase', opts.phase);
  params.set('limit', String(opts?.limit ?? 50));

  const { data, error, isLoading, mutate } = useSWR(
    `/api/runs?${params.toString()}`,
    fetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 2000,
    },
  );

  return {
    runs: data?.runs ?? [],
    isLoading,
    error,
    mutate,
  };
}
