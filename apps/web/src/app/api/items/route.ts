import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { listItems } from '@/lib/items';
import { withErrorHandler } from '@/lib/api-error';

export const runtime = 'edge';

export const GET = withErrorHandler(async (req) => {
  const env = getEnv();
  const url = new URL(req.url);
  const agentId = url.searchParams.get('agent_id') ?? 'radar';
  const grade = url.searchParams.get('grade');
  const since = url.searchParams.get('since');
  const status = url.searchParams.get('status');
  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw ? parseInt(limitRaw, 10) : 200;

  const items = await listItems(env.DB, { agentId, grade, since, status, limit });
  return NextResponse.json({ items });
});
