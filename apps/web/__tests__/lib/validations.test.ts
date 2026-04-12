import { describe, it, expect } from 'vitest';
import {
  itemBatchInputSchema,
  stateUpdateSchema,
  sourceCreateSchema,
  sourceUpdateSchema,
  rawItemBatchInputSchema,
  rawItemBatchStatusSchema,
  runCreateSchema,
  runUpdateSchema,
} from '../../src/lib/validations';

describe('itemBatchInputSchema', () => {
  it('accepts valid batch input', () => {
    const result = itemBatchInputSchema.safeParse({
      round_at: '2026-04-10T00:00:00Z',
      items: [
        {
          external_id: 'hn-123',
          agent_id: 'radar',
          item_type: 'recommendation',
          grade: 'fire',
          title: 'Test',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing round_at', () => {
    const result = itemBatchInputSchema.safeParse({ items: [] });
    expect(result.success).toBe(false);
  });

  it('defaults optional fields', () => {
    const result = itemBatchInputSchema.safeParse({
      round_at: '2026-01-01',
      items: [
        { external_id: 'x', agent_id: 'radar', item_type: 'recommendation', grade: 'bolt', title: 'T' },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].summary).toBe('');
      expect(result.data.items[0].tags).toEqual([]);
    }
  });
});

describe('stateUpdateSchema', () => {
  it('accepts valid status', () => {
    expect(stateUpdateSchema.safeParse({ status: 'watching' }).success).toBe(true);
    expect(stateUpdateSchema.safeParse({ status: 'dismissed' }).success).toBe(true);
  });

  it('rejects invalid status', () => {
    expect(stateUpdateSchema.safeParse({ status: 'invalid' }).success).toBe(false);
  });

  it('accepts empty body (dwell_ms only use case)', () => {
    // Both status and dwell_ms are optional in schema; route validates at least one is present
    expect(stateUpdateSchema.safeParse({}).success).toBe(true);
  });

  it('accepts dwell_ms', () => {
    expect(stateUpdateSchema.safeParse({ dwell_ms: 5000 }).success).toBe(true);
  });
});

describe('sourceCreateSchema', () => {
  it('accepts valid source', () => {
    const result = sourceCreateSchema.safeParse({
      agent_id: 'radar',
      source_type: 'hacker-news',
      name: 'HN Top',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.attention_weight).toBe(0);
      expect(result.data.enabled).toBe(true);
    }
  });

  it('validates weight range', () => {
    expect(
      sourceCreateSchema.safeParse({
        agent_id: 'radar',
        source_type: 'rss',
        name: 'Test',
        attention_weight: 1.5,
      }).success,
    ).toBe(false);
  });
});

describe('sourceUpdateSchema', () => {
  it('accepts partial updates', () => {
    expect(sourceUpdateSchema.safeParse({ name: 'New Name' }).success).toBe(true);
    expect(sourceUpdateSchema.safeParse({ enabled: false }).success).toBe(true);
    expect(sourceUpdateSchema.safeParse({}).success).toBe(true);
  });
});

describe('rawItemBatchInputSchema', () => {
  it('accepts valid raw item batch', () => {
    const result = rawItemBatchInputSchema.safeParse({
      items: [
        { source_id: 'src_1', agent_id: 'radar', external_id: 'ext-1', title: 'T' },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe('rawItemBatchStatusSchema', () => {
  it('accepts valid status update', () => {
    expect(
      rawItemBatchStatusSchema.safeParse({ ids: ['a', 'b'], status: 'promoted' }).success,
    ).toBe(true);
  });

  it('rejects invalid status', () => {
    expect(
      rawItemBatchStatusSchema.safeParse({ ids: ['a'], status: 'invalid' }).success,
    ).toBe(false);
  });
});

describe('runCreateSchema', () => {
  it('accepts valid run', () => {
    const result = runCreateSchema.safeParse({ agent_id: 'radar', phase: 'ingest' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.source_ids).toEqual([]);
    }
  });

  it('rejects invalid phase', () => {
    expect(
      runCreateSchema.safeParse({ agent_id: 'radar', phase: 'unknown' }).success,
    ).toBe(false);
  });
});

describe('runUpdateSchema', () => {
  it('accepts partial update', () => {
    expect(runUpdateSchema.safeParse({ status: 'done' }).success).toBe(true);
    expect(runUpdateSchema.safeParse({ error: 'timeout' }).success).toBe(true);
  });
});
