import { describe, it, expect } from 'vitest';
import { persistBodySchema } from '../../src/app/api/chat/persist/schema';

/**
 * Phase 2: /api/chat/persist accepts only session metadata.
 * Messages are persisted by LangGraph's AsyncSqliteSaver checkpointer.
 *
 * See docs/20-LANGGRAPH-PERSISTENCE.md.
 */
describe('persistBodySchema (Phase 2)', () => {
  it('accepts bare metadata-only payload', () => {
    const result = persistBodySchema.safeParse({
      agent_id: 'radar',
      thread_id: 'thread-1',
    });
    expect(result.success).toBe(true);
  });

  it('accepts payload with config_prompt + result_summary', () => {
    const result = persistBodySchema.safeParse({
      agent_id: 'radar',
      thread_id: 'thread-2',
      config_prompt: 'some config',
      result_summary: { evaluated: 10, promoted: 2, rejected: 8 },
    });
    expect(result.success).toBe(true);
  });

  it('strips unknown messages field (no longer persisted by BFF)', () => {
    // Even if a stale client sends `messages`, it should be stripped.
    const result = persistBodySchema.safeParse({
      agent_id: 'radar',
      thread_id: 'thread-3',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect('messages' in result.data).toBe(false);
    }
  });

  it('rejects missing agent_id', () => {
    const result = persistBodySchema.safeParse({ thread_id: 'thread-4' });
    expect(result.success).toBe(false);
  });

  it('rejects missing thread_id', () => {
    const result = persistBodySchema.safeParse({ agent_id: 'radar' });
    expect(result.success).toBe(false);
  });

  it('rejects empty strings', () => {
    const r1 = persistBodySchema.safeParse({ agent_id: '', thread_id: 't' });
    const r2 = persistBodySchema.safeParse({ agent_id: 'radar', thread_id: '' });
    expect(r1.success).toBe(false);
    expect(r2.success).toBe(false);
  });

  it('rejects invalid result_summary shape', () => {
    const result = persistBodySchema.safeParse({
      agent_id: 'radar',
      thread_id: 'thread-5',
      result_summary: { evaluated: 'not-a-number', promoted: 1, rejected: 0 },
    });
    expect(result.success).toBe(false);
  });
});
