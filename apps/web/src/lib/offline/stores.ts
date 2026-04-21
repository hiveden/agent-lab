/**
 * IndexedDB stores 集中配置（ADR-3: idb-keyval）。
 *
 * 命名规则：DB name 恒定 `agent-lab-offline`，每个功能一个 objectStore。
 * 不得在业务代码里手写 `createStore(...)` 字符串——从此文件 import 常量。
 *
 * SSR 保护：`createStore` 在 Node 环境会抛 `indexedDB is not defined`，
 * 所有 consumer 必须用 `typeof window !== 'undefined'` guard 或 `'use client'`。
 */
'use client';

import { createStore } from 'idb-keyval';

const DB_NAME = 'agent-lab-offline';

// 仅在浏览器侧实际创建 store（SSR 时这些常量为 undefined，
// 但因为 consumer 都是 client-side，引用时 window 已存在）。
const isBrowser = typeof window !== 'undefined';

export const QUERY_STORE = isBrowser
  ? createStore(DB_NAME, 'tanstack-query')
  : (undefined as never);

export const PENDING_STORE = isBrowser
  ? createStore(DB_NAME, 'pending')
  : (undefined as never);

export const ITEMS_STORE = isBrowser
  ? createStore(DB_NAME, 'items')
  : (undefined as never);
