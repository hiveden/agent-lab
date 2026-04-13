import useSWR from 'swr';
import type { ViewType } from '@/app/agents/radar/components/shared/NavRail';
import type { ItemWithState } from '@/lib/types';

const fetcher = (url: string) => fetch(url).then((r) => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<{ items: ItemWithState[] }>;
});

function viewToStatus(view: ViewType): string {
  if (view === 'watching') return 'watching';
  if (view === 'archive') return 'dismissed,discussed,applied,rejected';
  return 'unread';
}

export function useItems(activeView: ViewType) {
  const isItemView = activeView === 'inbox' || activeView === 'watching' || activeView === 'archive';
  const status = viewToStatus(activeView);
  const key = isItemView ? `/api/items?agent_id=radar&limit=400&status=${status}` : null;

  const { data, error, isLoading, mutate } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 2000,
  });

  return {
    items: data?.items ?? [],
    isLoading,
    error,
    mutate,
  };
}
