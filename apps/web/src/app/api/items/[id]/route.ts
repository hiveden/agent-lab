import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { getItem } from '@/lib/items';

export const runtime = 'edge';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const env = getEnv();
  const item = await getItem(env.DB, id);
  if (!item) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ item });
}
