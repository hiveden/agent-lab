import { NextResponse } from 'next/server';

/**
 * Standard API error response: { error: string, detail?: unknown }
 */
export function apiError(
  status: number,
  error: string,
  detail?: unknown,
): NextResponse {
  return NextResponse.json(
    { error, ...(detail !== undefined && { detail }) },
    { status },
  );
}

/**
 * Wrap an API route handler with try/catch.
 * Catches unhandled throws and returns 500.
 */
export function withErrorHandler(
  handler: (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>,
) {
  return async (req: Request, ctx: { params: Promise<Record<string, string>> }) => {
    try {
      return await handler(req, ctx);
    } catch (e) {
      console.error('[api]', req.method, req.url, e);
      return apiError(500, e instanceof Error ? e.message : 'internal error');
    }
  };
}
