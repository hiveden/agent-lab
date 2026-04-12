-- LLM 配置表（单行全局配置）
CREATE TABLE IF NOT EXISTS llm_settings (
  id                  TEXT PRIMARY KEY,
  provider            TEXT NOT NULL DEFAULT 'glm',
  model_push          TEXT NOT NULL DEFAULT 'glm-4-flash',
  model_chat          TEXT NOT NULL DEFAULT 'glm-4.6',
  model_tool          TEXT NOT NULL DEFAULT 'glm-4.6',
  base_url            TEXT NOT NULL DEFAULT 'https://open.bigmodel.cn/api/paas/v4',
  api_key_encrypted   TEXT,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO llm_settings (id) VALUES ('global');
