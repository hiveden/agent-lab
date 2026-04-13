'use client';

import type { ToolInvocation } from 'ai';
import { cn } from '@/lib/utils';

const TOOL_LABELS: Record<string, { label: string; icon: string }> = {
  github_stats: { label: 'GitHub', icon: '◆' },
  web_search: { label: '搜索', icon: '◇' },
  search_items: { label: '推荐库', icon: '▣' },
};

export default function ToolCard({ invocation }: { invocation: ToolInvocation }) {
  const meta = TOOL_LABELS[invocation.toolName] ?? { label: invocation.toolName, icon: '•' };
  const isLoading = invocation.state === 'partial-call' || invocation.state === 'call';

  return (
    <div className={cn('tool-card', isLoading && 'loading')}>
      <div className="tool-card-header">
        <span className="tool-card-icon">{meta.icon}</span>
        <span className="tool-card-label">{meta.label}</span>
        {isLoading && <span className="tool-card-spinner" />}
        {!isLoading && <span className="tool-card-done">✓</span>}
      </div>
      {!isLoading && invocation.state === 'result' && (
        <div className="tool-card-body">
          <ToolResult toolName={invocation.toolName} result={invocation.result} />
        </div>
      )}
    </div>
  );
}

function ToolResult({ toolName, result }: { toolName: string; result: unknown }) {
  const data = result as Record<string, unknown>;

  if (data?.error) {
    return <div className="tool-card-error">{String(data.error)}</div>;
  }

  switch (toolName) {
    case 'github_stats':
      return <GitHubResult data={data} />;
    case 'web_search':
      return <WebSearchResult data={data} />;
    case 'search_items':
      return <SearchItemsResult data={data} />;
    default:
      return <pre className="tool-card-json">{JSON.stringify(result, null, 2)}</pre>;
  }
}

function GitHubResult({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="tool-card-grid">
      <span className="tool-stat">⭐ {String(data.stars ?? '—')}</span>
      <span className="tool-stat">🍴 {String(data.forks ?? '—')}</span>
      <span className="tool-stat">📋 {String(data.open_issues ?? '—')} issues</span>
      {data.language ? <span className="tool-stat">🔤 {String(data.language)}</span> : null}
      {data.last_push ? (
        <span className="tool-stat">
          📅 {new Date(data.last_push as string).toLocaleDateString('zh-CN')}
        </span>
      ) : null}
      {data.description ? (
        <div className="tool-card-desc">{String(data.description)}</div>
      ) : null}
    </div>
  );
}

function WebSearchResult({ data }: { data: Record<string, unknown> }) {
  const results = data.results as Array<Record<string, string>> | undefined;
  if (data.summary) {
    return <div className="tool-card-desc">{String(data.summary)}</div>;
  }
  if (!results?.length) return <div className="tool-card-desc">无搜索结果</div>;
  return (
    <ul className="tool-card-list">
      {results.slice(0, 5).map((r, i) => (
        <li key={i}>
          {r.url ? (
            <a href={r.url} target="_blank" rel="noopener noreferrer">{r.title || r.url}</a>
          ) : (
            <span>{r.title}</span>
          )}
          {r.snippet && <p>{r.snippet}</p>}
        </li>
      ))}
    </ul>
  );
}

function SearchItemsResult({ data }: { data: Record<string, unknown> }) {
  const results = data.results as Array<Record<string, string>> | undefined;
  if (data.message) return <div className="tool-card-desc">{String(data.message)}</div>;
  if (!results?.length) return <div className="tool-card-desc">未找到相关推荐</div>;
  return (
    <ul className="tool-card-list">
      {results.map((r, i) => (
        <li key={i}>
          <span className={cn('tool-item-grade', r.grade)}>{r.grade}</span>
          <span>{r.title}</span>
          {r.url && (
            <a href={r.url} target="_blank" rel="noopener noreferrer" className="tool-card-link">↗</a>
          )}
        </li>
      ))}
    </ul>
  );
}
