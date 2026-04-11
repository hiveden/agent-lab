import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { getRun, updateRun } from '@/lib/runs';
import { runUpdateSchema } from '@/lib/validations';

export const runtime = 'edge';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const env = getEnv();
  const run = await getRun(env.DB, id);
  if (!run) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ run });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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
  const parsed = runUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'validation failed', issues: parsed.error.issues }, { status: 400 });
  }
  await updateRun(env.DB, id, parsed.data);
  return NextResponse.json({ ok: true });
}
