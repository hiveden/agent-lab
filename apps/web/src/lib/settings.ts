import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from './db';
import { llmSettings } from './db/schema';
import { eq, sql } from 'drizzle-orm';
import { encrypt, decrypt, maskKey } from './crypto';

const GLOBAL_ID = 'global';

export interface LlmSettingsRow {
  id: string;
  provider: string;
  model_push: string;
  model_chat: string;
  model_tool: string;
  base_url: string;
  api_key_encrypted: string | null;
  grok_api_key_encrypted: string | null;
  updated_at: string;
}

export interface LlmSettingsPublic {
  provider: string;
  model_push: string;
  model_chat: string;
  model_tool: string;
  base_url: string;
  api_key_masked: string;
  grok_api_key_masked: string;
  updated_at: string;
}

export interface LlmSettingsInternal {
  provider: string;
  model_push: string;
  model_chat: string;
  model_tool: string;
  base_url: string;
  api_key: string;
  grok_api_key: string;
}

export async function getRawSettings(d1: D1Database): Promise<LlmSettingsRow | null> {
  const db = getDb(d1);
  const rows = await db.select().from(llmSettings).where(eq(llmSettings.id, GLOBAL_ID)).limit(1);
  return (rows[0] as LlmSettingsRow) ?? null;
}

export async function getPublicSettings(
  d1: D1Database,
  secretHex: string,
  envOverrides?: {
    LLM_BASE_URL?: string;
    LLM_API_KEY?: string;
    LLM_MODEL_CHAT?: string;
    LLM_MODEL_TOOL?: string;
    LLM_MODEL_PUSH?: string;
    LLM_PROVIDER?: string;
    GROK_API_KEY?: string;
  },
): Promise<LlmSettingsPublic> {
  const row = await getRawSettings(d1);

  const decryptField = async (encrypted: string | null) => {
    if (!encrypted || !secretHex) return '';
    try { return maskKey(await decrypt(encrypted, secretHex)); }
    catch { return '(decrypt error)'; }
  };

  const db: LlmSettingsPublic = row
    ? {
        provider: row.provider,
        model_push: row.model_push,
        model_chat: row.model_chat,
        model_tool: row.model_tool,
        base_url: row.base_url,
        api_key_masked: await decryptField(row.api_key_encrypted),
        grok_api_key_masked: await decryptField(row.grok_api_key_encrypted),
        updated_at: row.updated_at,
      }
    : {
        provider: 'glm', model_push: 'glm-4-flash', model_chat: 'glm-4.6',
        model_tool: 'glm-4.6', base_url: 'https://open.bigmodel.cn/api/paas/v4',
        api_key_masked: '', grok_api_key_masked: '', updated_at: '',
      };

  // Priority: D1 > env vars > defaults
  const env = envOverrides ?? {};
  const hasDbConfig = !!row;
  return {
    provider: hasDbConfig ? db.provider : (env.LLM_PROVIDER || db.provider),
    model_push: hasDbConfig ? db.model_push : (env.LLM_MODEL_PUSH || db.model_push),
    model_chat: hasDbConfig ? db.model_chat : (env.LLM_MODEL_CHAT || db.model_chat),
    model_tool: hasDbConfig ? db.model_tool : (env.LLM_MODEL_TOOL || db.model_tool),
    base_url: hasDbConfig ? db.base_url : (env.LLM_BASE_URL || db.base_url),
    api_key_masked: hasDbConfig ? db.api_key_masked : (env.LLM_API_KEY ? maskKey(env.LLM_API_KEY) : db.api_key_masked),
    grok_api_key_masked: hasDbConfig ? db.grok_api_key_masked : (env.GROK_API_KEY ? maskKey(env.GROK_API_KEY) : db.grok_api_key_masked),
    updated_at: db.updated_at,
  };
}

export async function getInternalSettings(
  d1: D1Database,
  secretHex: string,
  envOverrides?: {
    LLM_BASE_URL?: string;
    LLM_API_KEY?: string;
    LLM_MODEL_CHAT?: string;
    LLM_MODEL_TOOL?: string;
    LLM_MODEL_PUSH?: string;
    LLM_PROVIDER?: string;
    GROK_API_KEY?: string;
  },
): Promise<LlmSettingsInternal> {
  // ── D1 config (baseline) ──
  const row = await getRawSettings(d1);
  const decryptField = async (encrypted: string | null) => {
    if (!encrypted || !secretHex) return '';
    try { return await decrypt(encrypted, secretHex); }
    catch { return ''; }
  };

  const db: LlmSettingsInternal = row
    ? {
        provider: row.provider,
        model_push: row.model_push,
        model_chat: row.model_chat,
        model_tool: row.model_tool,
        base_url: row.base_url,
        api_key: await decryptField(row.api_key_encrypted),
        grok_api_key: await decryptField(row.grok_api_key_encrypted),
      }
    : {
        provider: 'glm', model_push: 'glm-4-flash', model_chat: 'glm-4.6',
        model_tool: 'glm-4.6', base_url: 'https://open.bigmodel.cn/api/paas/v4',
        api_key: '', grok_api_key: '',
      };

  // ── Priority: D1 > env vars > defaults ──
  // D1 is user's explicit config (via Settings UI), highest priority.
  // Env vars are fallback for local dev when D1 is not configured.
  const env = envOverrides ?? {};
  const hasDbConfig = !!row;
  return {
    provider: hasDbConfig ? db.provider : (env.LLM_PROVIDER || db.provider),
    model_push: hasDbConfig ? db.model_push : (env.LLM_MODEL_PUSH || db.model_push),
    model_chat: hasDbConfig ? db.model_chat : (env.LLM_MODEL_CHAT || db.model_chat),
    model_tool: hasDbConfig ? db.model_tool : (env.LLM_MODEL_TOOL || db.model_tool),
    base_url: hasDbConfig ? db.base_url : (env.LLM_BASE_URL || db.base_url),
    api_key: hasDbConfig ? db.api_key : (env.LLM_API_KEY || db.api_key),
    grok_api_key: hasDbConfig ? db.grok_api_key : (env.GROK_API_KEY || db.grok_api_key),
  };
}

export interface SettingsUpdateInput {
  provider?: string;
  model_push?: string;
  model_chat?: string;
  model_tool?: string;
  base_url?: string;
  api_key?: string;
  grok_api_key?: string;
}

export async function upsertSettings(
  d1: D1Database,
  secretHex: string,
  input: SettingsUpdateInput,
): Promise<void> {
  const db = getDb(d1);
  const set: Record<string, unknown> = {
    updated_at: sql`(datetime('now'))`,
  };
  if (input.provider !== undefined) set.provider = input.provider;
  if (input.model_push !== undefined) set.model_push = input.model_push;
  if (input.model_chat !== undefined) set.model_chat = input.model_chat;
  if (input.model_tool !== undefined) set.model_tool = input.model_tool;
  if (input.base_url !== undefined) set.base_url = input.base_url;
  if (input.api_key !== undefined && input.api_key !== '') {
    set.api_key_encrypted = await encrypt(input.api_key, secretHex);
  }
  if (input.grok_api_key !== undefined && input.grok_api_key !== '') {
    set.grok_api_key_encrypted = await encrypt(input.grok_api_key, secretHex);
  }

  // Upsert: try update first
  const existing = await getRawSettings(d1);
  if (existing) {
    await db.update(llmSettings).set(set).where(eq(llmSettings.id, GLOBAL_ID));
  } else {
    await db.insert(llmSettings).values({
      id: GLOBAL_ID,
      provider: (input.provider ?? 'glm'),
      model_push: (input.model_push ?? 'glm-4-flash'),
      model_chat: (input.model_chat ?? 'glm-4.6'),
      model_tool: (input.model_tool ?? 'glm-4.6'),
      base_url: (input.base_url ?? 'https://open.bigmodel.cn/api/paas/v4'),
      api_key_encrypted: input.api_key ? await encrypt(input.api_key, secretHex) : null,
    });
  }
}
