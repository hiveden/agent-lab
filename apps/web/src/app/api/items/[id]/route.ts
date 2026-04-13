import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { getItem } from '@/lib/items';
import { withErrorHandler } from '@/lib/api-error';

export const runtime = 'edge';

export const GET = withErrorHandler(async (_req, ctx) => {
  const { id } = await ctx.params;
  const env = getEnv();
  const item = await getItem(env.DB, id);
  if (!item) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ item });
});
