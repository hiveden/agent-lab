import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { upsertUserState } from '@/lib/items';
import { stateUpdateSchema } from '@/lib/validations';

export const runtime = 'edge';

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
  const parsed = stateUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid status', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  await upsertUserState(env.DB, id, parsed.data.status);
  return NextResponse.json({ ok: true });
}
