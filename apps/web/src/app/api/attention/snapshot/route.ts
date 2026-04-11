import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { computeAttentionSnapshot } from '@/lib/attention';

export const runtime = 'edge';

export async function GET(req: Request) {
  const env = getEnv();
  const url = new URL(req.url);
  const agentId = url.searchParams.get('agent_id') ?? 'radar';

  const snapshot = await computeAttentionSnapshot(env.DB, agentId);
  return NextResponse.json(snapshot);
}
