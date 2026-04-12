'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * 隐式停留时长追踪。
 *
 * 挂载时开始计时，切后台暂停，卸载或调 flush() 时上报。
 * 使用 sendBeacon 确保页面卸载时数据不丢失。
 */
export function useDwellTracker(itemId: string | null) {
  const startRef = useRef(0);
  const accumulatedRef = useRef(0);
  const activeRef = useRef(false);

  const start = useCallback(() => {
    if (!itemId) return;
    startRef.current = Date.now();
    activeRef.current = true;
  }, [itemId]);

  const pause = useCallback(() => {
    if (!activeRef.current) return;
    accumulatedRef.current += Date.now() - startRef.current;
    activeRef.current = false;
  }, []);

  const resume = useCallback(() => {
    if (activeRef.current || !itemId) return;
    startRef.current = Date.now();
    activeRef.current = true;
  }, [itemId]);

  const flush = useCallback(() => {
    if (!itemId) return;
    if (activeRef.current) {
      accumulatedRef.current += Date.now() - startRef.current;
      activeRef.current = false;
    }
    const ms = accumulatedRef.current;
    accumulatedRef.current = 0;
    if (ms < 500) return; // 小于 500ms 不上报

    // sendBeacon 用于页面卸载场景，fetch 用于正常切换
    const payload = JSON.stringify({ dwell_ms: ms });
    const url = `/api/items/${itemId}/state`;
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
    } else {
      fetch(url, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  }, [itemId]);

  // 自动 start/pause on visibility change
  useEffect(() => {
    if (!itemId) return;

    start();

    const onVisibility = () => {
      if (document.hidden) {
        pause();
      } else {
        resume();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, [itemId, start, pause, resume, flush]);

  return { flush };
}
