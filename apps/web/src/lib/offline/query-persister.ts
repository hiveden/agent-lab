/**
 * TanStack Query → idb-keyval 的 AsyncStorage 适配器（ADR-3）。
 *
 * 用法：
 *   const persister = createAsyncStoragePersister({ storage: idbQueryStorage });
 *   persistQueryClient({ queryClient, persister });
 */
'use client';

import { get, set, del } from 'idb-keyval';
import { QUERY_STORE } from './stores';

export const idbQueryStorage = {
  getItem: async (key: string) => {
    if (!QUERY_STORE) return null;
    const v = await get(key, QUERY_STORE);
    return v ?? null;
  },
  setItem: async (key: string, value: string) => {
    if (!QUERY_STORE) return;
    await set(key, value, QUERY_STORE);
  },
  removeItem: async (key: string) => {
    if (!QUERY_STORE) return;
    await del(key, QUERY_STORE);
  },
};
