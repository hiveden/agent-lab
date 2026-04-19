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
    const settings = await getInternalSettings(env.DB, env.SETTINGS_SECRET, env);
    return NextResponse.json({ settings });
  }

  // 前端调用：返回脱敏 api_key（env vars 覆盖后的实际值）
  const settings = await getPublicSettings(env.DB, env.SETTINGS_SECRET, env);
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

  // 通知 Python Agent 清 LLM 实例缓存, 让新配置立即生效 (#25, ADR-011).
  // fire-and-forget: 失败不阻塞响应; 偶发漏推时下游继续用旧实例, 下次改动再试.
  // 生产强一致可加 TTL pull 兜底, 当前单用户场景不需要.
  void fetch(`${env.RADAR_AGENT_BASE}/internal/reload-llm`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RADAR_WRITE_TOKEN}` },
  }).catch(() => {
    // 忽略网络错误 / Agent 未启动 / 401 等; 不让 Settings 写入失败
  });

  return NextResponse.json({ ok: true });
}
