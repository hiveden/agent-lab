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

/**
 * Agent 会话元数据 — Phase 3 A1 之后 Agent 路径（threadId 索引）使用。
 *
 * 消息内容不在 D1，由 LangGraph AsyncSqliteSaver checkpointer 持有
 * （`agents/radar/data/checkpoints.db`）。前端通过 CopilotKit MESSAGES_SNAPSHOT
 * 从 checkpointer 恢复消息。
 */
export interface AgentSessionMeta {
  session_id: string;
  config_prompt: string | null;
  result_summary: ResultSummary | null;
}

/**
 * Inbox 会话完整历史 — itemId 索引，走 AI SDK useChat + D1 chat_messages 表。
 *
 * ⚠️ 不要用于 Agent 路径。Agent 会话的消息不存 D1（见 AgentSessionMeta）。
 */
export interface InboxSessionHistory {
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

/** @deprecated 使用 InboxSessionHistory（Inbox 路径）或 AgentSessionMeta（Agent 路径）。 */
export type SessionHistory = InboxSessionHistory;

export async function getLatestSessionForItem(
  d1: D1Database,
  itemId: string,
): Promise<InboxSessionHistory | null> {
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

  // Messages are persisted by LangGraph AsyncSqliteSaver checkpointer since
  // Phase 2 (docs/20-LANGGRAPH-PERSISTENCE.md); chat_messages only holds legacy
  // rows. Preview is derived from session metadata (config_prompt → result_summary).
  return sessions.map((s) => {
    const configPreview = s.config_prompt?.slice(0, 50) ?? '';
    const resultPreview = s.result_summary
      ? `推 ${s.result_summary.promoted} / 滤 ${s.result_summary.rejected}`
      : '';
    const preview = configPreview || resultPreview;

    return {
      id: s.id,
      agent_id: s.agent_id ?? 'radar',
      config_prompt: s.config_prompt ?? null,
      result_summary: s.result_summary ?? null,
      created_at: s.created_at ?? '',
      preview,
    };
  });
}

/**
 * Get session by thread_id (session.id === thread_id as created by persist endpoint).
 */
export async function getSessionByThreadId(
  d1: D1Database,
  threadId: string,
): Promise<AgentSessionMeta | null> {
  // Agent 会话的消息由 LangGraph AsyncSqliteSaver 持有（见 AgentSessionMeta 注释），
  // 所以这里只查 chat_sessions 元数据，不再 JOIN chat_messages 表。
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

  return {
    session_id: session.id,
    config_prompt: session.config_prompt ?? null,
    result_summary: session.result_summary ?? null,
  };
}

