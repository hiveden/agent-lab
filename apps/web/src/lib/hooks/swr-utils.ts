export const swrFetcher = <T = unknown>(url: string): Promise<T> =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json() as Promise<T>;
  });

export const SWR_DEFAULT_OPTIONS = {
  revalidateOnFocus: false,
  dedupingInterval: 2000,
} as const;
