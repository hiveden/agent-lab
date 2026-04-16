import useSWR from 'swr';
import type { ViewType } from '@/app/agents/radar/components/shared/NavRail';
import type { ItemWithState } from '@/lib/types';
import { swrFetcher, SWR_DEFAULT_OPTIONS } from './swr-utils';

function viewToStatus(view: ViewType): string {
  if (view === 'watching') return 'watching';
  if (view === 'archive') return 'dismissed,discussed,applied,rejected';
  return 'unread';
}

export function useItems(activeView: ViewType) {
  const isItemView = activeView === 'inbox' || activeView === 'watching' || activeView === 'archive';
  const status = viewToStatus(activeView);
  const key = isItemView ? `/api/items?agent_id=radar&limit=400&status=${status}` : null;

  const { data, error, isLoading, mutate } = useSWR<{ items: ItemWithState[] }>(key, swrFetcher, SWR_DEFAULT_OPTIONS);

  return {
    items: data?.items ?? [],
    isLoading,
    error,
    mutate,
  };
}
