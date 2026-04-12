import { z } from 'zod';

// ── Items ──

export const itemBatchInputSchema = z.object({
  round_at: z.string(),
  items: z.array(
    z.object({
      external_id: z.string(),
      agent_id: z.string(),
      item_type: z.string(),
      grade: z.string(),
      title: z.string(),
      summary: z.string().optional().default(''),
      why: z.string().nullable().optional(),
      url: z.string().nullable().optional(),
      source: z.string().nullable().optional(),
      tags: z.array(z.string()).optional().default([]),
      payload: z.record(z.string(), z.unknown()).optional().default({}),
      round_at: z.string().optional(),
    }),
  ),
});

export type ItemBatchBody = z.infer<typeof itemBatchInputSchema>;

export const stateUpdateSchema = z.object({
  status: z.enum(['unread', 'watching', 'discussed', 'dismissed', 'applied', 'rejected']).optional(),
  dwell_ms: z.number().int().min(0).optional(),
});

// ── Sources ──

export const sourceCreateSchema = z.object({
  agent_id: z.string(),
  source_type: z.string(),
  name: z.string(),
  config: z.record(z.string(), z.unknown()).optional().default({}),
  attention_weight: z.number().min(0).max(1).optional().default(0),
  enabled: z.boolean().optional().default(true),
});

export const sourceUpdateSchema = z.object({
  name: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  attention_weight: z.number().min(0).max(1).optional(),
  enabled: z.boolean().optional(),
});

// ── Raw Items ──

export const rawItemBatchInputSchema = z.object({
  run_id: z.string().optional(),
  items: z.array(
    z.object({
      source_id: z.string(),
      agent_id: z.string(),
      external_id: z.string(),
      title: z.string(),
      url: z.string().nullable().optional(),
      raw_payload: z.record(z.string(), z.unknown()).optional().default({}),
    }),
  ),
});

export const rawItemBatchStatusSchema = z.object({
  ids: z.array(z.string()),
  status: z.enum(['pending', 'evaluated', 'promoted', 'rejected']),
});

// ── Runs ──

export const runCreateSchema = z.object({
  agent_id: z.string(),
  phase: z.enum(['ingest', 'evaluate']),
  source_ids: z.array(z.string()).optional().default([]),
});

export const runUpdateSchema = z.object({
  status: z.enum(['running', 'done', 'failed']).optional(),
  stats: z.record(z.string(), z.unknown()).optional(),
  trace: z.array(z.unknown()).optional(),
  error: z.string().nullable().optional(),
  finished_at: z.string().optional(),
});

// ── LLM Settings ──

export const llmSettingsUpdateSchema = z.object({
  provider: z.enum(['glm', 'ollama', 'anthropic']).optional(),
  model_push: z.string().min(1).optional(),
  model_chat: z.string().min(1).optional(),
  model_tool: z.string().min(1).optional(),
  base_url: z.string().min(1).optional(),
  api_key: z.string().optional(),
});

export const testConnectionSchema = z.object({
  provider: z.enum(['glm', 'ollama', 'anthropic']),
  base_url: z.string().min(1),
  api_key: z.string().optional().default(''),
  model: z.string().min(1),
});
