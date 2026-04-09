import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { getLatestSessionForItem } from '@/lib/chat';

export const runtime = 'edge';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const { itemId } = await params;
  const env = getEnv();
  const history = await getLatestSessionForItem(env.DB, itemId);
  if (!history) {
    return NextResponse.json({ session_id: null, messages: [] });
  }
  return NextResponse.json(history);
}
