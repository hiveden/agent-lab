-- Seed: GitHub Trending (http type)
INSERT OR IGNORE INTO sources (id, agent_id, source_type, name, config, attention_weight, enabled)
VALUES (
  'src_github_trending', 'radar', 'http', 'GitHub Trending',
  '{"url":"https://api.github.com/search/repositories?q=created:%3E2026-04-01&sort=stars&order=desc&per_page=10","method":"GET","items_path":"items","mapping":{"external_id":"full_name","title":"full_name","url":"html_url"},"limit":10}',
  0.0, 1
);

-- Seed: AI News RSS
INSERT OR IGNORE INTO sources (id, agent_id, source_type, name, config, attention_weight, enabled)
VALUES (
  'src_ai_news_rss', 'radar', 'rss', 'AI News (smol.ai)',
  '{"feed_url":"https://buttondown.com/ainews/rss","limit":10}',
  0.0, 1
);

-- Grok API key 字段 (0005 合并，避免多个 ALTER TABLE)
-- 注意：如果 0005_grok_api_key.sql 已经跑过，这里会报错，用 OR IGNORE 处理不了 ALTER
-- 所以把 ALTER TABLE 放在单独的 0005_grok_api_key.sql 里
