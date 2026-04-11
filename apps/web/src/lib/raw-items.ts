import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from './db';
import { rawItems } from './db/schema';
import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import type { RawItemStatus } from '@agent-lab/types';

export interface RawItemInsert {
  source_id: string;
  agent_id: string;
  external_id: string;
  title: string;
  url?: string | null;
  raw_payload?: Record<string, unknown>;
}

export async function insertRawItemsBatch(
  d1: D1Database,
  items: RawItemInsert[],
  runId?: string,
) {
  if (!items.length) return { inserted: 0, skipped: 0 };
  const db = getDb(d1);

  const values = items.map((it) => ({
    id: crypto.randomUUID(),
    source_id: it.source_id,
    agent_id: it.agent_id,
    external_id: it.external_id,
    title: it.title,
    url: it.url ?? null,
    raw_payload: it.raw_payload ?? {},
    run_id: runId ?? null,
  }));

  const res = await db.insert(rawItems).values(values).onConflictDoNothing();
  const inserted = res.meta.changes ?? 0;
  return { inserted, skipped: values.length - inserted };
}

export interface ListRawItemsOpts {
  agentId?: string;
  status?: RawItemStatus;
  runId?: string;
  sourceId?: string;
  limit?: number;
}

export async function listRawItems(d1: D1Database, opts: ListRawItemsOpts) {
  const db = getDb(d1);
  const conditions = [];
  if (opts.agentId) conditions.push(eq(rawItems.agent_id, opts.agentId));
  if (opts.status) conditions.push(eq(rawItems.status, opts.status));
  if (opts.runId) conditions.push(eq(rawItems.run_id, opts.runId));
  if (opts.sourceId) conditions.push(eq(rawItems.source_id, opts.sourceId));

  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);

  return db
    .select()
    .from(rawItems)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(rawItems.fetched_at))
    .limit(limit);
}

export async function updateRawItemsStatus(
  d1: D1Database,
  ids: string[],
  status: RawItemStatus,
) {
  if (!ids.length) return;
  const db = getDb(d1);
  await db.update(rawItems).set({ status }).where(inArray(rawItems.id, ids));
}

export interface FunnelStats {
  fetched: number;
  promoted: number;
  rejected: number;
  pending: number;
}

export async function getRawItemsFunnelStats(
  d1: D1Database,
  runId: string,
): Promise<FunnelStats> {
  const db = getDb(d1);
  const rows = await db
    .select({
      status: rawItems.status,
      count: sql<number>`count(*)`.as('count'),
    })
    .from(rawItems)
    .where(eq(rawItems.run_id, runId))
    .groupBy(rawItems.status);

  const stats: FunnelStats = { fetched: 0, promoted: 0, rejected: 0, pending: 0 };
  for (const row of rows) {
    stats.fetched += row.count;
    if (row.status === 'promoted') stats.promoted = row.count;
    else if (row.status === 'rejected') stats.rejected = row.count;
    else if (row.status === 'pending') stats.pending = row.count;
  }
  return stats;
}
