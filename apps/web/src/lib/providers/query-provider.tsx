/**
 * TanStack Query 全局 Provider（ADR-2, ADR-3, ADR-9）。
 *
 * - 模块级 queryClient 单例（方案 A）：供 Zustand slice 等 hook 外代码 import 使用
 * - persistQueryClient + idb-keyval：重刷/离线 cache 保留
 * - networkMode: 'offlineFirst'：为 Step 9 PWA offline 打底
 * - Provider props 稳定引用（ADR-9，#32 教训）
 */
'use client';

import { useEffect, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { idbQueryStorage } from '@/lib/offline/query-persister';

/**
 * 模块级单例。SSR 时也会被引用（Zustand slice import），但 queryClient 本身
 * 是纯数据结构，无 window 依赖，SSR 时 new 出来不会报错。persistQueryClient
 * 才需要 window — 放在 useEffect 里。
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2000,              // ≈ SWR dedupingInterval
      refetchOnWindowFocus: false,  // ≈ SWR revalidateOnFocus: false
      networkMode: 'offlineFirst',  // Step 9 PWA/Offline 打底
      retry: 1,
    },
    mutations: {
      networkMode: 'offlineFirst',
      retry: 1,
    },
  },
});

export function QueryProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    // 只在浏览器侧挂 persister；cache 未恢复时 queries 仍可正常工作（fresh fetch）
    if (typeof window === 'undefined') return;
    const persister = createAsyncStoragePersister({
      storage: idbQueryStorage,
      // 默认 JSON.stringify/parse — idb-keyval 存字符串完全 OK。
    });
    const [unsubscribe] = persistQueryClient({
      queryClient,
      persister,
      maxAge: 1000 * 60 * 60 * 24, // 24h
      buster: 'v1', // cache 结构变更时改这里即可 invalidate 所有持久化
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
