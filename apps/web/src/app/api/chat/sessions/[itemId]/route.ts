import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { getLatestSessionForItem } from '@/lib/chat';
import { withErrorHandler } from '@/lib/api-error';

export const runtime = 'edge';

export const GET = withErrorHandler(async (_req, ctx) => {
  const { itemId } = await ctx.params;
  const env = getEnv();
  const history = await getLatestSessionForItem(env.DB, itemId);
  if (!history) {
    return NextResponse.json({ session_id: null, messages: [] });
  }
  return NextResponse.json(history);
});
