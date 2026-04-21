'use client';

import { useEffect, useState } from 'react';

/**
 * 三档窗口尺寸类（Material 3 window size class 命名）。
 * 见 docs/mobile-playbook/02-breakpoints-and-shells.md。
 *
 * - compact  : < 768px   （iPhone 竖屏、折叠屏折叠态、小窗分屏）
 * - medium   : 768-1279  （iPad 竖屏、MacBook 分屏半屏、折叠屏展开）
 * - expanded : ≥ 1280    （MacBook 全屏、外接显示器）
 */
export type Viewport = 'compact' | 'medium' | 'expanded';

const QUERIES = {
  compact: '(max-width: 767px)',
  medium: '(min-width: 768px) and (max-width: 1279px)',
  expanded: '(min-width: 1280px)',
} as const;

/**
 * SSR-safe viewport hook。
 *
 * 首次渲染（SSR / 客户端 hydration 初值）返回 `initialShell`——若未提供则为
 * `undefined`，调用方应渲染骨架。实际值在 `useEffect` 执行后到达。
 *
 * 配合 layout 层读取 `Sec-CH-UA-Mobile` header 传入 `initialShell`（UA Hint），
 * 可大幅降低首屏 CLS——详见 02-breakpoints-and-shells.md §2。
 */
export function useViewport(initialShell?: Viewport): Viewport | undefined {
  const [viewport, setViewport] = useState<Viewport | undefined>(initialShell);

  useEffect(() => {
    const entries = (Object.entries(QUERIES) as [Viewport, string][]).map(
      ([vp, q]) => ({ vp, mql: window.matchMedia(q) }),
    );

    const resolve = () => {
      const hit = entries.find(({ mql }) => mql.matches);
      if (hit) setViewport(hit.vp);
    };

    resolve();
    entries.forEach(({ mql }) => mql.addEventListener('change', resolve));
    return () =>
      entries.forEach(({ mql }) => mql.removeEventListener('change', resolve));
  }, []);

  return viewport;
}
