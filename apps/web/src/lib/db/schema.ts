import { sqliteTable, text, integer, real, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// Utility for JSON columns in SQLite
const jsonType = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();

export const items = sqliteTable(
  'items',
  {
    id: text('id').primaryKey(),
    external_id: text('external_id').notNull().unique(),
    agent_id: text('agent_id').notNull(),
    item_type: text('item_type').notNull(),
    grade: text('grade').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    why: text('why'),
    url: text('url'),
    source: text('source'),
    tags: jsonType<string[]>('tags').notNull().default(sql`'[]'`),
    payload: jsonType<Record<string, unknown>>('payload').notNull().default(sql`'{}'`),
    round_at: text('round_at').notNull(),
    created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index('idx_items_agent_round').on(table.agent_id, table.round_at), // SQLite indexes support DESC implicitly, but Drizzle builder might need raw SQL for strict DESC. Drizzle will handle the index creation.
    index('idx_items_grade').on(table.grade),
  ]
);

export const userStates = sqliteTable(
  'user_states',
  {
    item_id: text('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    user_id: text('user_id').notNull(),
    status: text('status').notNull(),
    view_duration_ms: integer('view_duration_ms').notNull().default(0),
    updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    primaryKey({ columns: [table.item_id, table.user_id] }),
  ]
);

export const chatSessions = sqliteTable(
  'chat_sessions',
  {
    id: text('id').primaryKey(),
    item_id: text('item_id').references(() => items.id, { onDelete: 'set null' }),
    agent_id: text('agent_id').notNull(),
    created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index('idx_chat_sessions_item').on(table.item_id),
  ]
);

export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id: text('id').primaryKey(),
    session_id: text('session_id')
      .notNull()
      .references(() => chatSessions.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // 'user' | 'assistant' | 'tool' | 'system'
    content: text('content').notNull(),
    tool_calls: jsonType<unknown[]>('tool_calls'),
    created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index('idx_chat_messages_session').on(table.session_id, table.created_at),
  ]
);

// ── Sources ──

export const sources = sqliteTable(
  'sources',
  {
    id: text('id').primaryKey(),
    agent_id: text('agent_id').notNull(),
    source_type: text('source_type').notNull(),
    name: text('name').notNull(),
    config: jsonType<Record<string, unknown>>('config').notNull().default(sql`'{}'`),
    attention_weight: real('attention_weight').notNull().default(0.0),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
    updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index('idx_sources_agent').on(table.agent_id),
  ]
);

// ── Raw Items ──

export const rawItems = sqliteTable(
  'raw_items',
  {
    id: text('id').primaryKey(),
    source_id: text('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    agent_id: text('agent_id').notNull(),
    external_id: text('external_id').notNull(),
    title: text('title').notNull(),
    url: text('url'),
    raw_payload: jsonType<Record<string, unknown>>('raw_payload').notNull().default(sql`'{}'`),
    status: text('status').notNull().default('pending'),
    run_id: text('run_id'),
    fetched_at: text('fetched_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index('idx_raw_items_status').on(table.agent_id, table.status),
    index('idx_raw_items_run').on(table.run_id),
    uniqueIndex('idx_raw_items_source_ext').on(table.source_id, table.external_id),
  ]
);

// ── Runs ──

export const runs = sqliteTable(
  'runs',
  {
    id: text('id').primaryKey(),
    agent_id: text('agent_id').notNull(),
    phase: text('phase').notNull(),
    status: text('status').notNull().default('running'),
    source_ids: jsonType<string[]>('source_ids').notNull().default(sql`'[]'`),
    stats: jsonType<Record<string, unknown>>('stats').notNull().default(sql`'{}'`),
    trace: jsonType<unknown[]>('trace').notNull().default(sql`'[]'`),
    error: text('error'),
    started_at: text('started_at').notNull().default(sql`(datetime('now'))`),
    finished_at: text('finished_at'),
  },
  (table) => [
    index('idx_runs_agent_phase').on(table.agent_id, table.phase, table.started_at),
  ]
);

// ── LLM Settings ──

export const llmSettings = sqliteTable('llm_settings', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull().default('glm'),
  model_push: text('model_push').notNull().default('glm-4-flash'),
  model_chat: text('model_chat').notNull().default('glm-4.6'),
  model_tool: text('model_tool').notNull().default('glm-4.6'),
  base_url: text('base_url').notNull().default('https://open.bigmodel.cn/api/paas/v4'),
  api_key_encrypted: text('api_key_encrypted'),
  updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
});
