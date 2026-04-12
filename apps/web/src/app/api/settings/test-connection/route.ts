import { NextResponse } from 'next/server';
import { testConnectionSchema } from '@/lib/validations';

export const runtime = 'edge';

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const parsed = testConnectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { provider, base_url, api_key, model } = parsed.data;

  try {
    if (provider === 'ollama') {
      // Ollama: 检查 /v1/models
      const res = await fetch(`${base_url}/models`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
      return NextResponse.json({ ok: true, detail: 'Ollama connected' });
    }

    // GLM / Anthropic: 发一个最小 completion 请求
    const res = await fetch(`${base_url}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${api_key}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`API returned ${res.status}: ${text.slice(0, 200)}`);
    }

    return NextResponse.json({ ok: true, detail: `${provider} connected` });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: String(e instanceof Error ? e.message : e),
    });
  }
}
