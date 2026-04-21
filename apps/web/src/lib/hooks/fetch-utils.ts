/**
 * 共用 fetch + JSON + error 辅助函数。
 * 从 Step 0 的 swr-utils.ts 重命名而来（ADR-2 迁移至 TanStack Query v5）。
 */

export const fetchJSON = <T = unknown>(url: string): Promise<T> =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json() as Promise<T>;
  });

// 向后兼容别名（ADR-2 Step 0.4 过渡期）。使用 TanStack Query 的新代码请用 fetchJSON。
export const swrFetcher = fetchJSON;
