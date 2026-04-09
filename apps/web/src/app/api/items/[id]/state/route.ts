import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { upsertUserState } from '@/lib/items';
import type { ItemStatus } from '@/lib/types';

export const runtime = 'edge';

const VALID: ItemStatus[] = [
  'unread',
  'watching',
  'discussed',
  'dismissed',
  'applied',
  'rejected',
];

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const env = getEnv();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const status = (body as { status?: string } | null)?.status;
  if (!status || !VALID.includes(status as ItemStatus)) {
    return NextResponse.json(
      { error: `invalid status; must be one of ${VALID.join(',')}` },
      { status: 400 },
    );
  }
  await upsertUserState(env.DB, id, status as ItemStatus);
  return NextResponse.json({ ok: true });
}
