import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { listRawItems } from '@/lib/raw-items';
import type { RawItemStatus } from '@agent-lab/types';

export const runtime = 'edge';

export async function GET(req: Request) {
  const env = getEnv();
  const url = new URL(req.url);
  const rows = await listRawItems(env.DB, {
    agentId: url.searchParams.get('agent_id') ?? undefined,
    status: (url.searchParams.get('status') as RawItemStatus) ?? undefined,
    runId: url.searchParams.get('run_id') ?? undefined,
    sourceId: url.searchParams.get('source_id') ?? undefined,
    limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
  });
  return NextResponse.json({ raw_items: rows });
}
