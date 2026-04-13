import { tool } from 'ai';
import { jsonSchema } from 'ai';
import type { D1Database } from '@cloudflare/workers-types';
import { getDb } from '../db';
import { items } from '../db/schema';
import { sql, desc } from 'drizzle-orm';

export function createSearchItemsTool(db: D1Database) {
  return tool({
    description: '搜索已有的推荐条目数据库，查找相关或类似的内容。当用户问"还有类似的吗"、"相关推荐"时使用。',
    parameters: jsonSchema<{ query: string; limit?: number }>({
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
        limit: { type: 'number', description: '返回条数上限，默认 5' },
      },
      required: ['query'],
    }),
    execute: async ({ query, limit = 5 }) => {
      const drizzle = getDb(db);
      const pattern = `%${query}%`;
      const rows = await drizzle
        .select({
          title: items.title,
          summary: items.summary,
          grade: items.grade,
          url: items.url,
          source: items.source,
          why: items.why,
        })
        .from(items)
        .where(sql`(${items.title} LIKE ${pattern} OR ${items.summary} LIKE ${pattern})`)
        .orderBy(desc(items.round_at))
        .limit(Math.min(limit, 10));

      if (rows.length === 0) {
        return { results: [], message: `没有找到与"${query}"相关的推荐` };
      }
      return { results: rows, count: rows.length };
    },
  });
}
