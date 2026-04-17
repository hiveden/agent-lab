import { z } from 'zod';

/**
 * Persist chat session metadata (Phase 2).
 *
 * Messages themselves are persisted by LangGraph's AsyncSqliteSaver
 * checkpointer on the Python agent side. This endpoint only persists
 * session-level metadata (config_prompt, result_summary) so sessions
 * appear in the sidebar list and preserve historical snapshots.
 *
 * See docs/20-LANGGRAPH-PERSISTENCE.md.
 */
export const persistBodySchema = z.object({
  agent_id: z.string().min(1),
  thread_id: z.string().min(1),
  config_prompt: z.string().optional(),
  result_summary: z.object({
    evaluated: z.number(),
    promoted: z.number(),
    rejected: z.number(),
  }).optional(),
});

export type PersistBody = z.infer<typeof persistBodySchema>;
