import { getEnv } from '@/lib/env';
import { listSources } from '@/lib/sources';

export const runtime = 'edge';

/**
 * 触发 Radar Ingestion（采集原始内容）。
 * CP 读 sources 配置 → 发给 Python /ingest → 透传 SSE 进度流。
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

  // 读取 enabled sources
  const allSources = await listSources(env.DB, 'radar');
  const enabledSources = allSources
    .filter((s) => s.enabled)
    .map((s) => ({
      id: s.id,
      source_type: s.source_type,
      config: s.config,
    }));

  if (!enabledSources.length) {
    return new Response(
      JSON.stringify({ error: 'no enabled sources' }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  }

  try {
    const upstream = await fetch(`${base}/ingest`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.RADAR_WRITE_TOKEN}`,
      },
      body: JSON.stringify({ sources: enabledSources }),
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
