import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { computeAttentionSnapshot } from '@/lib/attention';
import { withErrorHandler } from '@/lib/api-error';

export const runtime = 'edge';

export const GET = withErrorHandler(async (req) => {
  const env = getEnv();
  const url = new URL(req.url);
  const agentId = url.searchParams.get('agent_id') ?? 'radar';

  const snapshot = await computeAttentionSnapshot(env.DB, agentId);
  return NextResponse.json(snapshot);
});
