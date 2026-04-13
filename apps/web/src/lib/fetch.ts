/**
 * Frontend fetch wrapper — throws on non-2xx responses.
 * Drop-in replacement for fetch() in mutation calls.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: { error: string; detail?: unknown },
  ) {
    super(body.error);
    this.name = 'ApiError';
  }
}

export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(input, init);
  if (!res.ok) {
    let body: { error: string; detail?: unknown };
    try {
      body = await res.json();
    } catch {
      body = { error: `HTTP ${res.status}` };
    }
    throw new ApiError(res.status, body);
  }
  return res;
}

/** Extract a human-readable error message from any caught value. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.body.error;
  if (e instanceof Error) return e.message;
  return String(e);
}
