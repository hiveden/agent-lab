import { tool } from 'ai';
import { jsonSchema } from 'ai';

export const githubStats = tool({
  description: '获取 GitHub 仓库的统计信息，包括 stars、forks、open issues、最近更新时间等。当用户问到某个开源项目的活跃度、可靠性时使用。',
  parameters: jsonSchema<{ repo: string }>({
    type: 'object',
    properties: {
      repo: { type: 'string', description: 'GitHub 仓库，格式为 owner/repo，例如 anthropics/claude-code' },
    },
    required: ['repo'],
  }),
  execute: async ({ repo }) => {
    const res = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'agent-lab' },
    });
    if (!res.ok) {
      return { error: `GitHub API 返回 ${res.status}：找不到仓库 ${repo}` };
    }
    const data = await res.json() as Record<string, unknown>;
    return {
      name: data.full_name,
      description: data.description,
      stars: data.stargazers_count,
      forks: data.forks_count,
      open_issues: data.open_issues_count,
      language: data.language,
      last_push: data.pushed_at,
      created: data.created_at,
      license: (data.license as Record<string, unknown>)?.spdx_id ?? null,
      archived: data.archived,
    };
  },
});
