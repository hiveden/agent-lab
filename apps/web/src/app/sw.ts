/// <reference lib="webworker" />

/**
 * Service Worker 入口（ADR-7 · Serwist Phase 2）。
 *
 * 只在 production build 生成（dev 由 next.config.mjs 的 `disable` 禁用）。
 * 输出到 `public/sw.js`，浏览器从 `/sw.js` 注册。
 *
 * Cache 策略（ADR-7 §4.2）：
 * - `/api/agent/chat` SSE 流           → NetworkOnly（绝不缓存，否则 SSE 卡死）
 * - `/api/items|runs|chat/sessions`    → StaleWhileRevalidate（离线可读旧数据）
 * - `/_next/static` hashed chunks      → CacheFirst（hash 变即新文件）
 * - 导航请求（HTML）                    → NetworkFirst（3s timeout → cache fallback）
 * - 静态资源（icons / manifest）        → StaleWhileRevalidate
 *
 * Background Sync（Step 9a 暂不启用）：Step 4 的 pending queue 目前同步 fetch，
 * 离线失败会直接 throw；Step 9b 或之后再接 Workbox BackgroundSyncPlugin
 * + IndexedDB 队列持久化。
 */

import {
  Serwist,
  NetworkOnly,
  NetworkFirst,
  StaleWhileRevalidate,
  CacheFirst,
  ExpirationPlugin,
} from 'serwist';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';

// Next.js 15 App Router 由 @serwist/next 在 build 时注入：
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // 新 SW 激活时立即替换旧版本（避免用户看到残留旧 chunk）
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    // ── SSE Chat：绝对不缓存 ──
    {
      matcher: ({ url }) => url.pathname.startsWith('/api/agent/chat'),
      handler: new NetworkOnly(),
    },
    // ── API 写请求（PATCH/POST/PUT/DELETE）不走 SW 缓存 ──
    {
      matcher: ({ url, request }) =>
        url.pathname.startsWith('/api/') && request.method !== 'GET',
      handler: new NetworkOnly(),
    },
    // ── 其他 API（GET）：Stale-While-Revalidate，离线可读旧数据 ──
    {
      matcher: ({ url, request }) =>
        request.method === 'GET' &&
        (url.pathname.startsWith('/api/items') ||
          url.pathname.startsWith('/api/runs') ||
          url.pathname.startsWith('/api/chat/sessions') ||
          url.pathname.startsWith('/api/sources') ||
          url.pathname.startsWith('/api/attention')),
      handler: new StaleWhileRevalidate({
        cacheName: 'api-get',
        plugins: [
          new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 }),
        ],
      }),
    },
    // ── Next.js 静态 chunks（hash 版本化）──
    {
      matcher: ({ url }) => url.pathname.startsWith('/_next/static'),
      handler: new CacheFirst({
        cacheName: 'next-static',
        plugins: [
          new ExpirationPlugin({
            maxEntries: 128,
            maxAgeSeconds: 60 * 60 * 24 * 30,
          }),
        ],
      }),
    },
    // ── 导航请求（HTML 页面）──
    {
      matcher: ({ request }) => request.mode === 'navigate',
      handler: new NetworkFirst({
        cacheName: 'pages',
        networkTimeoutSeconds: 3,
        plugins: [
          new ExpirationPlugin({ maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 }),
        ],
      }),
    },
    // ── 静态资产（icons / manifest / fonts）──
    {
      matcher: ({ request }) =>
        ['image', 'style', 'font'].includes(request.destination),
      handler: new StaleWhileRevalidate({
        cacheName: 'assets',
        plugins: [
          new ExpirationPlugin({
            maxEntries: 64,
            maxAgeSeconds: 60 * 60 * 24 * 30,
          }),
        ],
      }),
    },
  ],
});

serwist.addEventListeners();
