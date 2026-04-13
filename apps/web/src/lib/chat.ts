import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from './db';
import { chatSessions, chatMessages } from './db/schema';
import { eq, desc, asc } from 'drizzle-orm';

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return 'id_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function ensureSession(
  d1: D1Database,
  opts: { sessionId?: string | null; itemId?: string | null; agentId?: string },
): Promise<string> {
  const db = getDb(d1);
  if (opts.sessionId) {
    const results = await db
      .select({ id: chatSessions.id })
      .from(chatSessions)
      .where(eq(chatSessions.id, opts.sessionId))
      .limit(1);
    if (results.length > 0) return results[0].id;
  }
  const id = genId();
  await db.insert(chatSessions).values({
    id,
    item_id: opts.itemId ?? null,
    agent_id: opts.agentId ?? 'radar',
  });
  return id;
}

export async function insertMessage(
  d1: D1Database,
  sessionId: string,
  role: 'user' | 'assistant' | 'tool' | 'system',
  content: string,
  toolCalls: unknown[] | null = null,
): Promise<string> {
  const db = getDb(d1);
  const id = genId();
  await db.insert(chatMessages).values({
    id,
    session_id: sessionId,
    role,
    content,
    tool_calls: toolCalls,
  });
  return id;
}

export interface SessionHistory {
  session_id: string;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    tool_calls?: unknown[] | null;
    created_at: string;
  }>;
}

export async function getLatestSessionForItem(
  d1: D1Database,
  itemId: string,
): Promise<SessionHistory | null> {
  const db = getDb(d1);
  const sessions = await db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(eq(chatSessions.item_id, itemId))
    .orderBy(desc(chatSessions.created_at))
    .limit(1);

  if (sessions.length === 0) return null;
  const session = sessions[0];

  const messages = await db
    .select({
      id: chatMessages.id,
      role: chatMessages.role,
      content: chatMessages.content,
      tool_calls: chatMessages.tool_calls,
      created_at: chatMessages.created_at,
    })
    .from(chatMessages)
    .where(eq(chatMessages.session_id, session.id))
    .orderBy(asc(chatMessages.created_at));

  return { session_id: session.id, messages };
}

