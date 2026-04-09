// Re-export shared contract types from @agent-lab/types.
// Do NOT add new types here — edit packages/types/src/index.ts instead.
export * from '@agent-lab/types';

import type { Item, ItemStatus } from '@agent-lab/types';

export interface ItemWithState extends Item {
  status: ItemStatus;
}
