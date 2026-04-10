import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';
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
