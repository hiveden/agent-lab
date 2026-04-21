import { useQuery } from '@tanstack/react-query';
import type { ViewType } from '@/app/agents/radar/components/shared/NavRail';
import type { ItemWithState } from '@/lib/types';
import { swrFetcher } from './fetch-utils';

function viewToStatus(view: ViewType): string {
  if (view === 'watching') return 'watching';
  if (view === 'archive') return 'dismissed,discussed,applied,rejected';
  return 'unread';
}

export function useItems(activeView: ViewType) {
  const isItemView =
    activeView === 'inbox' || activeView === 'watching' || activeView === 'archive';
  const status = viewToStatus(activeView);

  const query = useQuery({
    queryKey: ['items', 'radar', status],
    queryFn: () =>
      swrFetcher<{ items: ItemWithState[] }>(
        `/api/items?agent_id=radar&limit=400&status=${status}`,
      ),
    enabled: isItemView,
  });

  return {
    items: query.data?.items ?? [],
    isLoading: query.isLoading,
    error: query.error,
    mutate: () => query.refetch(),
  };
}
