import type { D1Database } from '@cloudflare/workers-types';
import { githubStats } from './github-stats';
import { createSearchItemsTool } from './search-items';
import { createWebSearchTool } from './web-search';

export function createChatTools(deps: {
  db: D1Database;
  tavilyApiKey?: string;
}) {
  return {
    github_stats: githubStats,
    search_items: createSearchItemsTool(deps.db),
    web_search: createWebSearchTool(deps.tavilyApiKey ?? ''),
  };
}
