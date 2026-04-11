import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { listSources, createSource } from '@/lib/sources';
import { sourceCreateSchema } from '@/lib/validations';

export const runtime = 'edge';

export async function GET(req: Request) {
  const env = getEnv();
  const url = new URL(req.url);
  const agentId = url.searchParams.get('agent_id') ?? undefined;
  const rows = await listSources(env.DB, agentId);
  return NextResponse.json({ sources: rows });
}

export async function POST(req: Request) {
  const env = getEnv();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const parsed = sourceCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'validation failed', issues: parsed.error.issues }, { status: 400 });
  }
  const source = await createSource(env.DB, parsed.data);
  return NextResponse.json({ ok: true, source }, { status: 201 });
}
