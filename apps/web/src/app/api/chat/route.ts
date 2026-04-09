import { getEnv } from '@/lib/env';
import { ensureSession, insertMessage, getLatestSessionForItem } from '@/lib/chat';
import { getItem } from '@/lib/items';

export const runtime = 'edge';

const MOCK_REPLY =
  '[mock] 这是一条假回复,Phase 2 接真 LLM 后会变成 GLM 的输出。';

function sseEncode(event: string | null, data: string): Uint8Array {
  const parts: string[] = [];
  if (event) parts.push(`event: ${event}`);
  for (const line of data.split('\n')) parts.push(`data: ${line}`);
  parts.push('', '');
  return new TextEncoder().encode(parts.join('\n'));
}

async function mockStream(
  sessionId: string,
  env: ReturnType<typeof getEnv>,
): Promise<ReadableStream<Uint8Array>> {
  const chunks = MOCK_REPLY.match(/.{1,6}/g) ?? [MOCK_REPLY];
  let full = '';
  return new ReadableStream({
    async start(controller) {
      controller.enqueue(
        sseEncode(null, JSON.stringify({ type: 'session', session_id: sessionId })),
      );
      for (const c of chunks) {
        full += c;
        controller.enqueue(
          sseEncode(null, JSON.stringify({ type: 'delta', content: c })),
        );
        await new Promise((r) => setTimeout(r, 100));
      }
      controller.enqueue(sseEncode(null, '[DONE]'));
      controller.close();
      // Persist assistant message after stream completes (fire-and-forget).
      try {
        await insertMessage(env.DB, sessionId, 'assistant', full);
      } catch {
        /* ignore persist errors in mock path */
      }
    },
  });
}

async function upstreamStream(
  url: string,
  payload: unknown,
  sessionId: string,
  env: ReturnType<typeof getEnv>,
): Promise<Response | null> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      // Thinking models (Gemini 2.5 Pro) 可以 reasoning 很久才吐第一个 token
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok || !res.body) return null;

    // Tee the upstream: one copy streams to client, another accumulates for persistence.
    const [toClient, toPersist] = res.body.tee();
    (async () => {
      try {
        const reader = toPersist.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let full = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          // naive SSE extraction: concatenate any data: delta content we can find
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            try {
              const j = JSON.parse(data);
              if (j && typeof j.content === 'string') full += j.content;
            } catch {
              /* ignore non-json data lines */
            }
          }
        }
        await insertMessage(env.DB, sessionId, 'assistant', full);
      } catch {
        /* ignore */
      }
    })();

    // Prepend a session event for the client, then stream upstream body through.
    const prefix = sseEncode(
      null,
      JSON.stringify({ type: 'session', session_id: sessionId }),
    );
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(prefix);
        const reader = toClient.getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        'x-accel-buffering': 'no',
      },
    });
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const env = getEnv();
  let body: {
    item_id?: string | null;
    session_id?: string | null;
    message?: string;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid json' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (!body.message || typeof body.message !== 'string') {
    return new Response(JSON.stringify({ error: 'message required' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const sessionId = await ensureSession(env.DB, {
    sessionId: body.session_id ?? null,
    itemId: body.item_id ?? null,
    agentId: 'radar',
  });

  // Load item context + prior history BEFORE persisting current user msg,
  // so the history array we send upstream doesn't include this turn (it's the `message` field).
  let itemPayload: Record<string, unknown> | null = null;
  if (body.item_id) {
    try {
      const it = await getItem(env.DB, body.item_id);
      if (it) {
        itemPayload = {
          id: it.id,
          title: it.title,
          summary: it.summary,
          why: it.why,
          url: it.url,
          grade: it.grade,
          source: it.source,
          tags: it.tags,
        };
      }
    } catch {
      /* ignore — best effort context */
    }
  }

  let historyPayload: Array<{ role: string; content: string }> = [];
  if (body.item_id) {
    try {
      const hist = await getLatestSessionForItem(env.DB, body.item_id);
      if (hist?.messages?.length) {
        // 截取最近 10 条,避免 prompt 过长
        historyPayload = hist.messages.slice(-10).map((m) => ({
          role: m.role,
          content: m.content,
        }));
      }
    } catch {
      /* ignore */
    }
  }

  await insertMessage(env.DB, sessionId, 'user', body.message);

  // Try the real agent first.
  const base = env.RADAR_AGENT_BASE?.replace(/\/+$/, '');
  if (base) {
    const upstream = await upstreamStream(
      `${base}/chat`,
      {
        session_id: sessionId,
        item_id: body.item_id ?? null,
        message: body.message,
        item: itemPayload,
        history: historyPayload,
      },
      sessionId,
      env,
    );
    if (upstream) return upstream;
  }

  // Fallback: mock stream.
  const stream = await mockStream(sessionId, env);
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
