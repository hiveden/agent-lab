import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { ensureSession, updateSessionMetadata } from '@/lib/chat';
import { persistBodySchema } from './schema';

export const runtime = 'edge';

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

  const { agent_id, thread_id, config_prompt, result_summary } = parsed.data;

  try {
    // Ensure session exists (use thread_id as session_id)
    const sessionId = await ensureSession(env.DB, {
      sessionId: thread_id,
      agentId: agent_id,
    });

    // Update session metadata if provided
    if (config_prompt !== undefined || result_summary !== undefined) {
      const metadata: { config_prompt?: string; result_summary?: { evaluated: number; promoted: number; rejected: number } } = {};
      if (config_prompt !== undefined) metadata.config_prompt = config_prompt;
      if (result_summary !== undefined) metadata.result_summary = result_summary;
      await updateSessionMetadata(env.DB, sessionId, metadata);
    }

    return NextResponse.json({
      ok: true,
      session_id: sessionId,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'persist failed', detail: String(err) },
      { status: 500 },
    );
  }
}
