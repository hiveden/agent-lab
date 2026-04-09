-- agent-lab D1 schema v1
-- 通用化设计:items 表用 agent_id + item_type 区分不同 Agent,payload (JSON) 通用扩展

CREATE TABLE IF NOT EXISTS items (
  id           TEXT PRIMARY KEY,
  external_id  TEXT NOT NULL UNIQUE,
  agent_id     TEXT NOT NULL,
  item_type    TEXT NOT NULL,
  grade        TEXT NOT NULL,
  title        TEXT NOT NULL,
  summary      TEXT NOT NULL DEFAULT '',
  why          TEXT,
  url          TEXT,
  source       TEXT,
  tags         TEXT NOT NULL DEFAULT '[]',  -- JSON array
  payload      TEXT NOT NULL DEFAULT '{}',  -- JSON object
  round_at     TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_items_agent_round ON items(agent_id, round_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_grade ON items(grade);

CREATE TABLE IF NOT EXISTS user_states (
  item_id     TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  status      TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (item_id, user_id),
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id          TEXT PRIMARY KEY,
  item_id     TEXT,
  agent_id    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_item ON chat_sessions(item_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL,
  tool_calls  TEXT,  -- JSON array, nullable
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);
