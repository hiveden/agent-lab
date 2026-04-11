-- agent-lab D1 schema v2: sources + raw_items + runs
-- 拆分 Ingestion / Intelligence 两阶段

-- 可配置信息源
CREATE TABLE IF NOT EXISTS sources (
  id                TEXT PRIMARY KEY,
  agent_id          TEXT NOT NULL,
  source_type       TEXT NOT NULL,   -- 'hacker-news' | 'rss' | ...
  name              TEXT NOT NULL,
  config            TEXT NOT NULL DEFAULT '{}',   -- JSON
  attention_weight  REAL NOT NULL DEFAULT 0.0,    -- 0.0-1.0
  enabled           INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sources_agent ON sources(agent_id);

-- 原始内容池 (采集全量保留)
CREATE TABLE IF NOT EXISTS raw_items (
  id            TEXT PRIMARY KEY,
  source_id     TEXT NOT NULL,
  agent_id      TEXT NOT NULL,
  external_id   TEXT NOT NULL,
  title         TEXT NOT NULL,
  url           TEXT,
  raw_payload   TEXT NOT NULL DEFAULT '{}',   -- JSON: collector 原始输出
  status        TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'evaluated' | 'promoted' | 'rejected'
  run_id        TEXT,
  fetched_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE,
  UNIQUE(source_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_raw_items_status ON raw_items(agent_id, status);
CREATE INDEX IF NOT EXISTS idx_raw_items_run ON raw_items(run_id);

-- 执行记录
CREATE TABLE IF NOT EXISTS runs (
  id           TEXT PRIMARY KEY,
  agent_id     TEXT NOT NULL,
  phase        TEXT NOT NULL,     -- 'ingest' | 'evaluate'
  status       TEXT NOT NULL DEFAULT 'running',  -- 'running' | 'done' | 'failed'
  source_ids   TEXT NOT NULL DEFAULT '[]',  -- JSON array
  stats        TEXT NOT NULL DEFAULT '{}',  -- JSON
  trace        TEXT NOT NULL DEFAULT '[]',  -- JSON array of span events
  error        TEXT,
  started_at   TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_agent_phase ON runs(agent_id, phase, started_at DESC);

-- Seed: 默认 HN source
INSERT OR IGNORE INTO sources (id, agent_id, source_type, name, config, attention_weight, enabled)
VALUES ('src_hn_top', 'radar', 'hacker-news', 'Hacker News Top Stories', '{"limit":30}', 1.0, 1);
