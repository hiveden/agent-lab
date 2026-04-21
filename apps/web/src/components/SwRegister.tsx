'use client';

/**
 * Service Worker 注册（Step 9a）。
 *
 * 仅 production build 挂载（dev 下 next.config.mjs 禁用，公共 /sw.js 不存在）。
 * 浏览器自动调度 SW 更新；新版检测到后下次刷新激活（Serwist 配 skipWaiting
 * + clientsClaim，一次刷新即切到新 SW）。
 */

import { useEffect } from 'react';

export default function SwRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        });
        // 每小时主动检查一次更新（Cloudflare Pages 已 no-cache sw.js）
        setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
      } catch {
        /* ignore: SW 不影响业务功能，失败静默 */
      }
    };
    register();
  }, []);

  return null;
}
