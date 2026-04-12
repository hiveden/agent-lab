import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { getPublicSettings, getInternalSettings, upsertSettings } from '@/lib/settings';
import { llmSettingsUpdateSchema } from '@/lib/validations';

export const runtime = 'edge';

export async function GET(req: Request) {
  const env = getEnv();
  const url = new URL(req.url);
  const internal = url.searchParams.get('internal') === 'true';

  if (internal) {
    // Python Agent 调用：需要 Bearer auth，返回解密 api_key
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${env.RADAR_WRITE_TOKEN}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const settings = await getInternalSettings(env.DB, env.SETTINGS_SECRET);
    return NextResponse.json({ settings });
  }

  // 前端调用：返回脱敏 api_key
  const settings = await getPublicSettings(env.DB, env.SETTINGS_SECRET);
  return NextResponse.json({ settings });
}

export async function PUT(req: Request) {
  const env = getEnv();
  if (!env.SETTINGS_SECRET) {
    return NextResponse.json(
      { error: 'SETTINGS_SECRET not configured' },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const parsed = llmSettingsUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  await upsertSettings(env.DB, env.SETTINGS_SECRET, parsed.data);
  return NextResponse.json({ ok: true });
}
