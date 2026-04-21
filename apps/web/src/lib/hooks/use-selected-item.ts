'use client';

/**
 * URL 作为选中 item 的单一事实源（Step 2，URL-as-state）。
 *
 * 见 docs/mobile-playbook/01-architecture-rfc.md §6.3、
 *    docs/mobile-playbook/06-migration-roadmap.md Step 2。
 *
 * - selectedId 读自 `?item=xxx` search param
 * - setSelectedId 通过 router.push 更新 URL（不触发 full navigation，
 *   App Router 会做 shallow URL sync）
 * - 浏览器后退键天然生效（push 进历史栈）
 * - 分享 URL / 刷新页面保持选中
 *
 * 设计取舍（与 Parallel Routes 对比）：
 * - 方案 A（本实现）：search param → 同页 URL 同步，左列表 + 右栏布局不破坏
 * - 方案 B：`/items/[id]` path param + Parallel Routes @detail slot
 * 选 A：不过度工程化（CLAUDE.md 原则），Desktop 的双栏布局由 InboxView
 * 的 react-resizable-panels 维护，方案 B 需重构 panel 为 slot，代价过大。
 * URL 语义略弱但所有诉求（后退 / 刷新保持 / 分享）都满足。
 */

import { useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

export function useSelectedItem(): {
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
} {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const selectedId = searchParams.get('item') || null;

  const setSelectedId = useCallback(
    (id: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (id) {
        params.set('item', id);
      } else {
        params.delete('item');
      }
      const q = params.toString();
      const url = q ? `${pathname}?${q}` : pathname;
      // scroll: false 避免 router.push 触发 scroll-to-top（保持列表滚动位置）
      router.push(url, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return { selectedId, setSelectedId };
}
