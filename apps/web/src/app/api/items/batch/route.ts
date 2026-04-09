import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { insertItemsBatch } from '@/lib/items';

export const runtime = 'edge';

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
  const b = body as { round_at?: string; items?: unknown[] };
  if (!b || typeof b.round_at !== 'string' || !Array.isArray(b.items)) {
    return NextResponse.json(
      { error: 'invalid body: expected { round_at, items[] }' },
      { status: 400 },
    );
  }
  try {
    const result = await insertItemsBatch(
      env.DB,
      b.round_at,
      b.items as Parameters<typeof insertItemsBatch>[2],
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: 'insert failed', detail: String(err) },
      { status: 500 },
    );
  }
}
