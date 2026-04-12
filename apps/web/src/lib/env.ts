import { getRequestContext } from '@cloudflare/next-on-pages';
import type { D1Database } from '@cloudflare/workers-types';

export interface CloudflareEnv {
  DB: D1Database;
  RADAR_WRITE_TOKEN: string;
  RADAR_AGENT_BASE: string;
  SETTINGS_SECRET: string;
}

/**
 * Get Cloudflare bindings (D1 + vars) at runtime.
 * Works both in `next dev` (via @cloudflare/next-on-pages/next-dev) and in
 * Cloudflare Pages production.
 */
export function getEnv(): CloudflareEnv {
  const ctx = getRequestContext();
  return ctx.env as unknown as CloudflareEnv;
}

export const DEFAULT_USER_ID = 'default_user';
