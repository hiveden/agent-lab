import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { updateRawItemsStatus } from '@/lib/raw-items';
import { rawItemBatchStatusSchema } from '@/lib/validations';

export const runtime = 'edge';

export async function PATCH(req: Request) {
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
  const parsed = rawItemBatchStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'validation failed', issues: parsed.error.issues }, { status: 400 });
  }
  await updateRawItemsStatus(env.DB, parsed.data.ids, parsed.data.status);
  return NextResponse.json({ ok: true });
}
