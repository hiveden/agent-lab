import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { getSessionByThreadId, listAgentSessions } from '@/lib/chat';

export const runtime = 'edge';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const threadId = searchParams.get('thread_id');
  const agentId = searchParams.get('agent_id');

  const env = getEnv();

  // 模式 1: 按 agent_id 列出所有 sessions
  if (agentId) {
    try {
      const sessions = await listAgentSessions(env.DB, agentId);
      return NextResponse.json({ sessions });
    } catch (err) {
      return NextResponse.json(
        { error: 'failed to list sessions', detail: String(err) },
        { status: 500 },
      );
    }
  }

  // 模式 2: 按 thread_id 获取单个 session 的消息
  if (!threadId) {
    return NextResponse.json(
      { error: 'thread_id or agent_id is required' },
      { status: 400 },
    );
  }

  try {
    const result = await getSessionByThreadId(env.DB, threadId);

    if (!result) {
      return NextResponse.json({ session_id: null });
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: 'failed to fetch session', detail: String(err) },
      { status: 500 },
    );
  }
}
