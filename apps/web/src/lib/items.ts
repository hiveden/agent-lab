import type { D1Database } from '@cloudflare/workers-types';
import type { Item, ItemStatus } from '@/lib/types';
import type { ItemWithState } from '@/lib/types';
import { DEFAULT_USER_ID } from '@/lib/env';
import { getDb } from './db';
import { items, userStates } from './db/schema';
import { desc, eq, and, sql, gte } from 'drizzle-orm';

export interface ListOptions {
  agentId?: string;
  grade?: string | null;
  since?: string | null;
  limit?: number;
  status?: string | null;
}

export async function listItems(
  d1: D1Database,
  opts: ListOptions,
): Promise<ItemWithState[]> {
  const db = getDb(d1);
  const agentId = opts.agentId ?? 'radar';
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);

  const conditions = [eq(items.agent_id, agentId)];
  if (opts.grade) conditions.push(eq(items.grade, opts.grade));
  if (opts.since) conditions.push(gte(items.round_at, opts.since));
  
  if (opts.status) {
    const statuses = opts.status.split(',');
    const hasUnread = statuses.includes('unread');
    const sqlStatuses = statuses.map((s) => `'${s}'`).join(',');
    
    if (hasUnread) {
      // If asking for unread, it means status is null OR status IN (...)
      conditions.push(sql`(COALESCE(${userStates.status}, 'unread') IN (${sql.raw(sqlStatuses)}))`);
    } else {
      conditions.push(sql`(${userStates.status} IN (${sql.raw(sqlStatuses)}))`);
    }
  }

  const results = await db
    .select({
      id: items.id,
      external_id: items.external_id,
      agent_id: items.agent_id,
      item_type: items.item_type,
      grade: items.grade,
      title: items.title,
      summary: items.summary,
      why: items.why,
      url: items.url,
      source: items.source,
      tags: items.tags,
      payload: items.payload,
      round_at: items.round_at,
      created_at: items.created_at,
      status: sql<string>`COALESCE(${userStates.status}, 'unread')`.as('status'),
    })
    .from(items)
    .leftJoin(
      userStates,
      and(
        eq(userStates.item_id, items.id),
        eq(userStates.user_id, DEFAULT_USER_ID)
      )
    )
    .where(and(...conditions))
    .orderBy(desc(items.round_at), desc(items.created_at))
    .limit(limit);

  return results.map((row) => ({
    ...row,
    agent_id: row.agent_id as Item['agent_id'],
    item_type: row.item_type as Item['item_type'],
    grade: row.grade as Item['grade'],
    status: row.status as ItemStatus,
  }));
}

export async function getItem(
  d1: D1Database,
  id: string,
): Promise<ItemWithState | null> {
  const db = getDb(d1);
  const results = await db
    .select({
      id: items.id,
      external_id: items.external_id,
      agent_id: items.agent_id,
      item_type: items.item_type,
      grade: items.grade,
      title: items.title,
      summary: items.summary,
      why: items.why,
      url: items.url,
      source: items.source,
      tags: items.tags,
      payload: items.payload,
      round_at: items.round_at,
      created_at: items.created_at,
      status: sql<string>`COALESCE(${userStates.status}, 'unread')`.as('status'),
    })
    .from(items)
    .leftJoin(
      userStates,
      and(
        eq(userStates.item_id, items.id),
        eq(userStates.user_id, DEFAULT_USER_ID)
      )
    )
    .where(eq(items.id, id))
    .limit(1);

  if (!results.length) return null;

  const row = results[0];
  return {
    ...row,
    agent_id: row.agent_id as Item['agent_id'],
    item_type: row.item_type as Item['item_type'],
    grade: row.grade as Item['grade'],
    status: row.status as ItemStatus,
  };
}

export interface BatchInsertItem {
  external_id: string;
  agent_id: string;
  item_type: string;
  grade: string;
  title: string;
  summary?: string;
  why?: string | null;
  url?: string | null;
  source?: string | null;
  tags?: unknown[];
  payload?: Record<string, unknown>;
  round_at?: string;
}

export interface BatchResult {
  inserted: number;
  skipped: number;
}

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return 'id_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function insertItemsBatch(
  d1: D1Database,
  roundAt: string,
  batchItems: BatchInsertItem[],
): Promise<BatchResult> {
  if (!batchItems.length) return { inserted: 0, skipped: 0 };
  const db = getDb(d1);

  const valuesToInsert = batchItems.map((it) => ({
    id: genId(),
    external_id: it.external_id,
    agent_id: it.agent_id,
    item_type: it.item_type,
    grade: it.grade,
    title: it.title,
    summary: it.summary ?? '',
    why: it.why ?? null,
    url: it.url ?? null,
    source: it.source ?? null,
    tags: (it.tags ?? []) as string[],
    payload: it.payload ?? {},
    round_at: it.round_at ?? roundAt,
  }));

  // D1 / SQLite does not support returning number of rows inserted cleanly with ON CONFLICT DO NOTHING
  // via simple driver sometimes, but we can do a naive insert and catch constraints.
  // Actually, Drizzle allows `.onConflictDoNothing()` which we will use.
  let inserted = 0;
  let skipped = 0;
  
  for (const val of valuesToInsert) {
    try {
      const res = await db.insert(items).values(val).onConflictDoNothing();
      if (res.meta.changes > 0) inserted++;
      else skipped++;
    } catch (e) {
      skipped++;
    }
  }

  return { inserted, skipped };
}

export async function upsertUserState(
  d1: D1Database,
  itemId: string,
  status: ItemStatus,
): Promise<void> {
  const db = getDb(d1);
  await db
    .insert(userStates)
    .values({
      item_id: itemId,
      user_id: DEFAULT_USER_ID,
      status: status,
      updated_at: sql`(datetime('now'))`,
    })
    .onConflictDoUpdate({
      target: [userStates.item_id, userStates.user_id],
      set: {
        status: status,
        updated_at: sql`(datetime('now'))`,
      },
    });
}

