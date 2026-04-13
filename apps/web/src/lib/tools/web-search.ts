import { tool } from 'ai';
import { jsonSchema } from 'ai';

/**
 * Web search tool — Tavily Search API.
 * Free tier: 1000 queries/month.
 */
export function createWebSearchTool(apiKey: string) {
  return tool({
    description: '搜索互联网获取最新信息、对比分析、评测等。当用户问到实时数据、最新动态、对比不同方案时使用。',
    parameters: jsonSchema<{ query: string; max_results?: number }>({
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索查询词' },
        max_results: { type: 'number', description: '最大结果数，默认 5' },
      },
      required: ['query'],
    }),
    execute: async ({ query, max_results = 5 }) => {
      if (!apiKey) {
        return { error: '搜索未配置：需要 TAVILY_API_KEY' };
      }

      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          max_results: Math.min(max_results, 10),
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        return { error: `Tavily API 返回 ${res.status}: ${body.slice(0, 200)}` };
      }

      const data = await res.json() as {
        results?: Array<{ title: string; url: string; content: string; score: number }>;
      };

      if (!data.results?.length) {
        return { results: [], message: `未找到 "${query}" 的搜索结果` };
      }

      return {
        results: data.results.map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.content,
        })),
      };
    },
  });
}
