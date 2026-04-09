import type { D1Database } from '@cloudflare/workers-types';

function genId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return 'id_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export async function ensureSession(
  db: D1Database,
  opts: { sessionId?: string | null; itemId?: string | null; agentId?: string },
): Promise<string> {
  if (opts.sessionId) {
    const row = await db
      .prepare('SELECT id FROM chat_sessions WHERE id = ?')
      .bind(opts.sessionId)
      .first<{ id: string }>();
    if (row) return row.id;
  }
  const id = genId();
  await db
    .prepare(
      `INSERT INTO chat_sessions (id, item_id, agent_id) VALUES (?, ?, ?)`,
    )
    .bind(id, opts.itemId ?? null, opts.agentId ?? 'radar')
    .run();
  return id;
}

export async function insertMessage(
  db: D1Database,
  sessionId: string,
  role: 'user' | 'assistant' | 'tool' | 'system',
  content: string,
  toolCalls: unknown[] | null = null,
): Promise<string> {
  const id = genId();
  await db
    .prepare(
      `INSERT INTO chat_messages (id, session_id, role, content, tool_calls)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, sessionId, role, content, toolCalls ? JSON.stringify(toolCalls) : null)
    .run();
  return id;
}

export interface SessionHistory {
  session_id: string;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    created_at: string;
  }>;
}

export async function getLatestSessionForItem(
  db: D1Database,
  itemId: string,
): Promise<SessionHistory | null> {
  const session = await db
    .prepare(
      `SELECT id FROM chat_sessions WHERE item_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(itemId)
    .first<{ id: string }>();
  if (!session) return null;
  const messages = await db
    .prepare(
      `SELECT id, role, content, created_at FROM chat_messages
       WHERE session_id = ? ORDER BY created_at ASC`,
    )
    .bind(session.id)
    .all<{ id: string; role: string; content: string; created_at: string }>();
  return { session_id: session.id, messages: messages.results ?? [] };
}
