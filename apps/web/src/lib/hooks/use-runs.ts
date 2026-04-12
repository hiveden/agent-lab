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

export function useRuns() {
  const { data, error, isLoading, mutate } = useSWR(
    '/api/runs?agent_id=radar&limit=50',
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
