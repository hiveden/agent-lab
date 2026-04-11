import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from './db';
import { sources } from './db/schema';
import { eq, sql } from 'drizzle-orm';

export async function listSources(d1: D1Database, agentId?: string) {
  const db = getDb(d1);
  if (agentId) {
    return db.select().from(sources).where(eq(sources.agent_id, agentId));
  }
  return db.select().from(sources);
}

export async function getSource(d1: D1Database, id: string) {
  const db = getDb(d1);
  const rows = await db.select().from(sources).where(eq(sources.id, id)).limit(1);
  return rows[0] ?? null;
}

export interface SourceCreateInput {
  agent_id: string;
  source_type: string;
  name: string;
  config?: Record<string, unknown>;
  attention_weight?: number;
  enabled?: boolean;
}

export async function createSource(d1: D1Database, input: SourceCreateInput) {
  const db = getDb(d1);
  const id = `src_${crypto.randomUUID().slice(0, 8)}`;
  const row = {
    id,
    agent_id: input.agent_id,
    source_type: input.source_type,
    name: input.name,
    config: input.config ?? {},
    attention_weight: input.attention_weight ?? 0,
    enabled: input.enabled ?? true,
  };
  await db.insert(sources).values(row);
  return row;
}

export interface SourceUpdateInput {
  name?: string;
  config?: Record<string, unknown>;
  attention_weight?: number;
  enabled?: boolean;
}

export async function updateSource(d1: D1Database, id: string, patch: SourceUpdateInput) {
  const db = getDb(d1);
  const set: Record<string, unknown> = { updated_at: sql`(datetime('now'))` };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.config !== undefined) set.config = patch.config;
  if (patch.attention_weight !== undefined) set.attention_weight = patch.attention_weight;
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  await db.update(sources).set(set).where(eq(sources.id, id));
}

export async function deleteSource(d1: D1Database, id: string) {
  const db = getDb(d1);
  await db.delete(sources).where(eq(sources.id, id));
}
