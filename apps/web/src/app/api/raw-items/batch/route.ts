import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { insertRawItemsBatch } from '@/lib/raw-items';
import { rawItemBatchInputSchema } from '@/lib/validations';

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
  const parsed = rawItemBatchInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'validation failed', issues: parsed.error.issues }, { status: 400 });
  }
  try {
    const result = await insertRawItemsBatch(env.DB, parsed.data.items, parsed.data.run_id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: 'insert failed', detail: String(err) }, { status: 500 });
  }
}
