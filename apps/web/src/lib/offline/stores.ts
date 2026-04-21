/**
 * IndexedDB stores 集中配置（ADR-3: idb-keyval）。
 *
 * 命名规则：DB name 恒定 `agent-lab-offline`，每个功能一个 objectStore。
 * 不得在业务代码里手写 `createStore(...)` 字符串——从此文件 import 常量。
 *
 * SSR 保护：`createStore` 在 Node 环境会抛 `indexedDB is not defined`，
 * 所有 consumer 必须用 `typeof window !== 'undefined'` guard 或 `'use client'`。
 *
 * 约定：新增 store 时在此文件添加 export，不在业务代码里手写 createStore。
 */
'use client';

import { createStore } from 'idb-keyval';

const DB_NAME = 'agent-lab-offline';

const isBrowser = typeof window !== 'undefined';

// TanStack Query cache 持久化（Step 0）
export const QUERY_STORE = isBrowser
  ? createStore(DB_NAME, 'tanstack-query')
  : (undefined as never);
