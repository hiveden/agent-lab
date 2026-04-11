import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { listRuns, createRun } from '@/lib/runs';
import { runCreateSchema } from '@/lib/validations';

export const runtime = 'edge';

export async function GET(req: Request) {
  const env = getEnv();
  const url = new URL(req.url);
  const rows = await listRuns(env.DB, {
    agentId: url.searchParams.get('agent_id') ?? undefined,
    phase: url.searchParams.get('phase') ?? undefined,
    limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
  });
  return NextResponse.json({ runs: rows });
}

export async function POST(req: Request) {
  const env = getEnv();
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
  const parsed = runCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'validation failed', issues: parsed.error.issues }, { status: 400 });
  }
  const run = await createRun(env.DB, parsed.data);
  return NextResponse.json({ ok: true, run }, { status: 201 });
}
