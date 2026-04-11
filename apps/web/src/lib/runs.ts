import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from './db';
import { runs } from './db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';

export interface RunCreateInput {
  agent_id: string;
  phase: string;
  source_ids?: string[];
}

export async function createRun(d1: D1Database, input: RunCreateInput) {
  const db = getDb(d1);
  const id = crypto.randomUUID();
  const row = {
    id,
    agent_id: input.agent_id,
    phase: input.phase,
    source_ids: input.source_ids ?? [],
  };
  await db.insert(runs).values(row);
  return { ...row, status: 'running' as const };
}

export interface RunUpdateInput {
  status?: string;
  stats?: Record<string, unknown>;
  trace?: unknown[];
  error?: string | null;
  finished_at?: string;
}

export async function updateRun(d1: D1Database, id: string, patch: RunUpdateInput) {
  const db = getDb(d1);
  const set: Record<string, unknown> = {};
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.stats !== undefined) set.stats = patch.stats;
  if (patch.trace !== undefined) set.trace = patch.trace;
  if (patch.error !== undefined) set.error = patch.error;
  if (patch.finished_at !== undefined) {
    set.finished_at = patch.finished_at;
  } else if (patch.status === 'done' || patch.status === 'failed') {
    set.finished_at = sql`(datetime('now'))`;
  }
  await db.update(runs).set(set).where(eq(runs.id, id));
}

export interface ListRunsOpts {
  agentId?: string;
  phase?: string;
  limit?: number;
}

export async function listRuns(d1: D1Database, opts: ListRunsOpts) {
  const db = getDb(d1);
  const conditions = [];
  if (opts.agentId) conditions.push(eq(runs.agent_id, opts.agentId));
  if (opts.phase) conditions.push(eq(runs.phase, opts.phase));

  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);

  return db
    .select()
    .from(runs)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(runs.started_at))
    .limit(limit);
}

export async function getRun(d1: D1Database, id: string) {
  const db = getDb(d1);
  const rows = await db.select().from(runs).where(eq(runs.id, id)).limit(1);
  return rows[0] ?? null;
}
