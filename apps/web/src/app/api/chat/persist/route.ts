import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { ensureSession, insertMessage } from '@/lib/chat';
import { z } from 'zod';

export const runtime = 'edge';

const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'tool', 'system']),
  content: z.string(),
  tool_calls: z.array(z.unknown()).nullable().optional(),
});

const persistBodySchema = z.object({
  agent_id: z.string().min(1),
  thread_id: z.string().min(1),
  messages: z.array(messageSchema).min(1),
});

export async function POST(req: Request) {
  const env = getEnv();

  // Bearer token auth (same pattern as /api/items/batch)
  const auth = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${env.RADAR_WRITE_TOKEN}`;
  if (!env.RADAR_WRITE_TOKEN || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const parsed = persistBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { agent_id, thread_id, messages } = parsed.data;

  try {
    // Ensure session exists (use thread_id as session_id)
    const sessionId = await ensureSession(env.DB, {
      sessionId: thread_id,
      agentId: agent_id,
    });

    // Insert all messages
    const messageIds: string[] = [];
    for (const msg of messages) {
      const id = await insertMessage(
        env.DB,
        sessionId,
        msg.role,
        msg.content,
        msg.tool_calls ?? null,
      );
      messageIds.push(id);
    }

    return NextResponse.json({
      ok: true,
      session_id: sessionId,
      message_count: messageIds.length,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'persist failed', detail: String(err) },
      { status: 500 },
    );
  }
}
