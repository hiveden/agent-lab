-- Seed: 掘金热榜 (http type)
INSERT OR IGNORE INTO sources (id, agent_id, source_type, name, config, attention_weight, enabled)
VALUES (
  'src_juejin_hot', 'radar', 'http', '掘金热榜',
  '{"url":"https://api.juejin.cn/content_api/v1/content/article_rank?category_id=1&type=hot","method":"POST","headers":{"Content-Type":"application/json"},"body":{},"items_path":"data","mapping":{"external_id":"content.content_id","title":"content.title","url_template":"https://juejin.cn/post/{content.content_id}"},"limit":10}',
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
