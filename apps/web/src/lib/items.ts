import type { D1Database } from '@cloudflare/workers-types';
import type { Item, ItemStatus } from '@/lib/types';
import type { ItemWithState } from '@/lib/types';
import { DEFAULT_USER_ID } from '@/lib/env';

// Row as it appears in D1 (SQLite returns TEXT for JSON columns).
interface ItemRow {
  id: string;
  external_id: string;
  agent_id: string;
  item_type: string;
  grade: string;
  title: string;
  summary: string;
  why: string | null;
  url: string | null;
  source: string | null;
  tags: string;
  payload: string;
  round_at: string;
  created_at: string;
  status: string | null;
}

function rowToItem(row: ItemRow): ItemWithState {
  return {
    id: row.id,
    external_id: row.external_id,
    agent_id: row.agent_id as Item['agent_id'],
    item_type: row.item_type as Item['item_type'],
    grade: row.grade as Item['grade'],
    title: row.title,
    summary: row.summary,
    why: row.why,
    url: row.url,
    source: row.source,
    tags: safeJson<string[]>(row.tags, []),
    payload: safeJson<Record<string, unknown>>(row.payload, {}),
    round_at: row.round_at,
    created_at: row.created_at,
    status: (row.status ?? 'unread') as ItemStatus,
  };
}

function safeJson<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export interface ListOptions {
  agentId?: string;
  grade?: string | null;
  since?: string | null;
  limit?: number;
}

export async function listItems(
  db: D1Database,
  opts: ListOptions,
): Promise<ItemWithState[]> {
  const agentId = opts.agentId ?? 'radar';
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  const clauses: string[] = ['items.agent_id = ?'];
  const params: unknown[] = [agentId];
  if (opts.grade) {
    clauses.push('items.grade = ?');
    params.push(opts.grade);
  }
  if (opts.since) {
    clauses.push('items.round_at >= ?');
    params.push(opts.since);
  }
  const sql = `
    SELECT items.*, COALESCE(us.status, 'unread') AS status
    FROM items
    LEFT JOIN user_states us
      ON us.item_id = items.id AND us.user_id = ?
    WHERE ${clauses.join(' AND ')}
    ORDER BY items.round_at DESC, items.created_at DESC
    LIMIT ?
  `;
  const stmt = db.prepare(sql).bind(DEFAULT_USER_ID, ...params, limit);
  const res = await stmt.all<ItemRow>();
  return (res.results ?? []).map(rowToItem);
}

export async function getItem(
  db: D1Database,
  id: string,
): Promise<ItemWithState | null> {
  const sql = `
    SELECT items.*, COALESCE(us.status, 'unread') AS status
    FROM items
    LEFT JOIN user_states us
      ON us.item_id = items.id AND us.user_id = ?
    WHERE items.id = ?
    LIMIT 1
  `;
  const row = await db.prepare(sql).bind(DEFAULT_USER_ID, id).first<ItemRow>();
  return row ? rowToItem(row) : null;
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
  // Use crypto.randomUUID if available (Workers runtime has it).
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return 'id_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function insertItemsBatch(
  db: D1Database,
  roundAt: string,
  items: BatchInsertItem[],
): Promise<BatchResult> {
  if (!items.length) return { inserted: 0, skipped: 0 };

  const stmts = items.map((it) => {
    const id = genId();
    return db
      .prepare(
        `INSERT OR IGNORE INTO items
          (id, external_id, agent_id, item_type, grade, title, summary, why, url, source, tags, payload, round_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        it.external_id,
        it.agent_id,
        it.item_type,
        it.grade,
        it.title,
        it.summary ?? '',
        it.why ?? null,
        it.url ?? null,
        it.source ?? null,
        JSON.stringify(it.tags ?? []),
        JSON.stringify(it.payload ?? {}),
        it.round_at ?? roundAt,
      );
  });

  const results = await db.batch(stmts);
  let inserted = 0;
  let skipped = 0;
  for (const r of results) {
    const changes = (r.meta as { changes?: number } | undefined)?.changes ?? 0;
    if (changes > 0) inserted += 1;
    else skipped += 1;
  }
  return { inserted, skipped };
}

export async function upsertUserState(
  db: D1Database,
  itemId: string,
  status: ItemStatus,
): Promise<void> {
  const sql = `
    INSERT INTO user_states (item_id, user_id, status, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(item_id, user_id) DO UPDATE SET
      status = excluded.status,
      updated_at = excluded.updated_at
  `;
  await db.prepare(sql).bind(itemId, DEFAULT_USER_ID, status).run();
}
