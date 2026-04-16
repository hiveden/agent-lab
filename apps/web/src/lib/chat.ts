import type { D1Database } from '@cloudflare/workers-types';
import type { ResultSummary } from '@agent-lab/types';
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
  const id = opts.sessionId ?? genId();
  await db.insert(chatSessions).values({
    id,
    item_id: opts.itemId ?? null,
    agent_id: opts.agentId ?? 'radar',
  });
  return id;
}

export async function updateSessionMetadata(
  d1: D1Database,
  sessionId: string,
  metadata: { config_prompt?: string; result_summary?: ResultSummary },
): Promise<void> {
  const db = getDb(d1);
  await db
    .update(chatSessions)
    .set(metadata)
    .where(eq(chatSessions.id, sessionId));
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
  config_prompt: string | null;
  result_summary: ResultSummary | null;
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
    .select({
      id: chatSessions.id,
      config_prompt: chatSessions.config_prompt,
      result_summary: chatSessions.result_summary,
    })
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

  return {
    session_id: session.id,
    config_prompt: session.config_prompt ?? null,
    result_summary: session.result_summary ?? null,
    messages,
  };
}

export interface SessionSummary {
  id: string;
  agent_id: string;
  config_prompt: string | null;
  result_summary: ResultSummary | null;
  created_at: string;
  message_count: number;
  preview: string;
}

export async function listAgentSessions(
  d1: D1Database,
  agentId: string,
  limit = 20,
): Promise<SessionSummary[]> {
  const db = getDb(d1);

  const sessions = await db
    .select({
      id: chatSessions.id,
      agent_id: chatSessions.agent_id,
      config_prompt: chatSessions.config_prompt,
      result_summary: chatSessions.result_summary,
      created_at: chatSessions.created_at,
    })
    .from(chatSessions)
    .where(eq(chatSessions.agent_id, agentId))
    .orderBy(desc(chatSessions.created_at))
    .limit(limit);

  const result: SessionSummary[] = [];
  for (const s of sessions) {
    const msgs = await db
      .select({ id: chatMessages.id, role: chatMessages.role, content: chatMessages.content })
      .from(chatMessages)
      .where(eq(chatMessages.session_id, s.id))
      .orderBy(asc(chatMessages.created_at));

    const firstUser = msgs.find(m => m.role === 'user');
    result.push({
      id: s.id,
      agent_id: s.agent_id ?? 'radar',
      config_prompt: s.config_prompt ?? null,
      result_summary: s.result_summary ?? null,
      created_at: s.created_at ?? '',
      message_count: msgs.length,
      preview: firstUser?.content?.slice(0, 50) ?? '',
    });
  }

  // 过滤掉空 session（0 条消息）
  return result.filter(s => s.message_count > 0);
}

/**
 * Get session by thread_id (session.id === thread_id as created by persist endpoint).
 */
export async function getSessionByThreadId(
  d1: D1Database,
  threadId: string,
): Promise<SessionHistory | null> {
  const db = getDb(d1);
  const sessions = await db
    .select({
      id: chatSessions.id,
      config_prompt: chatSessions.config_prompt,
      result_summary: chatSessions.result_summary,
    })
    .from(chatSessions)
    .where(eq(chatSessions.id, threadId))
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

  return {
    session_id: session.id,
    config_prompt: session.config_prompt ?? null,
    result_summary: session.result_summary ?? null,
    messages,
  };
}

