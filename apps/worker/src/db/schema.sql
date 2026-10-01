-- Drawing Workbench schema (D1 / SQLite)
-- 会话为 HMAC 签名的无状态 token，无需建表。
-- 约定：时间统一用 datetime('now')（UTC 字符串）；JSON 字段用 *_json 后缀。

CREATE TABLE IF NOT EXISTS upstreams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  base_url TEXT NOT NULL,
  auth_enc TEXT,
  models_json TEXT NOT NULL DEFAULT '[]',
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  transform_json TEXT NOT NULL DEFAULT '{}',
  priority INTEGER NOT NULL DEFAULT 0,
  weight INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS models (
  logical_name TEXT NOT NULL,
  upstream_id TEXT NOT NULL REFERENCES upstreams(id) ON DELETE CASCADE,
  upstream_model TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (logical_name, upstream_id)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'friend',
  allowed_models_json TEXT NOT NULL DEFAULT '[]',
  allowed_upstreams_json TEXT NOT NULL DEFAULT '[]',
  quota INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  rate_limit INTEGER,
  expires_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rewrite_rules (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'all',
  match_json TEXT NOT NULL DEFAULT '{}',
  action_json TEXT NOT NULL DEFAULT '{}',
  priority INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS generations (
  id TEXT PRIMARY KEY,
  key_id TEXT REFERENCES api_keys(id) ON DELETE SET NULL,
  role TEXT NOT NULL,
  upstream_id TEXT REFERENCES upstreams(id) ON DELETE SET NULL,
  params_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  anlas_cost INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  generation_id TEXT REFERENCES generations(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  mime TEXT,
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS usage_counters (
  key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (key_id, period)
);

CREATE INDEX IF NOT EXISTS idx_generations_created_at
  ON generations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_generation
  ON assets (generation_id);
CREATE INDEX IF NOT EXISTS idx_upstreams_enabled
  ON upstreams (enabled, priority DESC);
CREATE INDEX IF NOT EXISTS idx_rewrite_rules_scope
  ON rewrite_rules (scope, priority DESC);
