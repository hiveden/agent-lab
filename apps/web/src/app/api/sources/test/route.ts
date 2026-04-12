import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';

export const runtime = 'edge';

/**
 * POST /api/sources/test
 * 代理到 Python /test-collect，验证 source 配置能否采集数据。
 */
export async function POST(req: Request) {
  const env = getEnv();
  const base = env.RADAR_AGENT_BASE?.replace(/\/+$/, '');
  if (!base) {
    return NextResponse.json({ error: 'RADAR_AGENT_BASE not configured' }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  try {
    const upstream = await fetch(`${base}/test-collect`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.RADAR_WRITE_TOKEN}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 502 });
  }
}
