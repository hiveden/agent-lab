import { getEnv } from '@/lib/env';

export const runtime = 'edge';

/**
 * 触发 Radar Evaluate（LLM 评判筛选）。
 * 转发到 Python /evaluate → 透传 SSE 进度流。
 */
export async function POST() {
  const env = getEnv();
  const base = env.RADAR_AGENT_BASE?.replace(/\/+$/, '');
  if (!base) {
    return new Response(
      JSON.stringify({ error: 'RADAR_AGENT_BASE not configured' }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );
  }

  try {
    const upstream = await fetch(`${base}/evaluate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.RADAR_WRITE_TOKEN}`,
      },
      body: JSON.stringify({ agent_id: 'radar' }),
      signal: AbortSignal.timeout(180_000),
    });

    if (!upstream.ok || !upstream.body) {
      const txt = await upstream.text().catch(() => '');
      return new Response(
        JSON.stringify({ error: `upstream ${upstream.status}`, detail: txt }),
        { status: 502, headers: { 'content-type': 'application/json' } },
      );
    }

    return new Response(upstream.body, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        'x-accel-buffering': 'no',
      },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: 'upstream fetch failed', detail: String(e) }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    );
  }
}
