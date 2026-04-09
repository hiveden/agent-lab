import { getEnv } from '@/lib/env';

export const runtime = 'edge';

/**
 * 手动触发 Radar 推送流。
 *
 * 从前端(或调度器)调用,转发到 Agent `/cron/push` 并把 SSE 进度事件透传回来。
 * 前端用来显示实时 trace 面板,让用户看到"拉 HN → LLM 选 → 写库"的全过程。
 *
 * 鉴权:header `Authorization: Bearer <RADAR_WRITE_TOKEN>`(复用已有 token)。
 * 生产环境的定时调度器(Fly.io Machines / CF Cron)也用同一个端点 + token。
 */
export async function POST(req: Request) {
  const env = getEnv();

  // MVP:单用户本地/私有部署,incoming 不做鉴权。
  // Agent 的 /cron/push 仍然需要 bearer — 我们在下面的 upstream 调用里内部注入。
  // 生产公开部署时,这里应该加 session 或 URL 签名校验。

  let body: { limit?: number };
  try {
    body = (await req.json()) as { limit?: number };
  } catch {
    body = {};
  }

  const base = env.RADAR_AGENT_BASE?.replace(/\/+$/, '');
  if (!base) {
    return new Response(
      JSON.stringify({ error: 'RADAR_AGENT_BASE not configured' }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );
  }

  try {
    const upstream = await fetch(`${base}/cron/push`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.RADAR_WRITE_TOKEN}`,
      },
      body: JSON.stringify({ limit: body.limit ?? 30 }),
      // Push 可能跑 10-60 秒(拉 HN + LLM + 写库),给足时间
      signal: AbortSignal.timeout(180_000),
    });

    if (!upstream.ok || !upstream.body) {
      const txt = await upstream.text().catch(() => '');
      return new Response(
        JSON.stringify({ error: `upstream ${upstream.status}`, detail: txt }),
        { status: 502, headers: { 'content-type': 'application/json' } },
      );
    }

    // 直接透传 SSE
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
