'use client';

import { useEffect, useState } from 'react';

/**
 * SSR-safe media query hook。
 *
 * 首次渲染返回 undefined（服务端不知道屏幕宽度），
 * effect 执行后返回真实值。消费方用 `if (isMobile === undefined)` 渲染骨架或 null。
 */
export function useMediaQuery(query: string): boolean | undefined {
  const [matches, setMatches] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

export function useIsMobile(): boolean | undefined {
  return useMediaQuery('(max-width: 640px)');
}
