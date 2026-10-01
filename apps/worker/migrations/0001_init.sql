-- 0001: D1 数据模型 V2 —— 本项目 v1 通用表（通用化）
-- 依据：docs/docs/01-需求与架构/03-数据模型.md §5.1
-- 说明：V1 旧表（由已废弃的 src/db/schema.sql 手工建立）在此升级中被替换。
--      这两处曾各自定义，升级后结构唯一来源为 migrations/。
--      旧表在本地与远程均无数据（升级前已核对），故安全重建。
PRAGMA foreign_keys = ON;

-- 旧 v1 表（按外键依赖从子到父顺序删除）
DROP TABLE IF EXISTS assets;
DROP TABLE IF EXISTS generations;
DROP TABLE IF EXISTS usage_counters;
DROP TABLE IF EXISTS models;
DROP TABLE IF EXISTS rewrite_rules;
DROP TABLE IF EXISTS api_keys;
DROP TABLE IF EXISTS upstreams;

-- 上游配置（type 含 nai-compatible / openai-compatible / 模板）
CREATE TABLE upstreams (
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
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_upstreams_enabled ON upstreams (enabled, priority DESC);

-- 账号池；credential_enc 用 AES-GCM 加密，永不回传明文
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  upstream_id TEXT NOT NULL REFERENCES upstreams(id) ON DELETE CASCADE,
  label TEXT,
  username TEXT NOT NULL,
  credential_enc TEXT,
  gems_last INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'pending',
  failure_count INTEGER NOT NULL DEFAULT 0,
  cooldown_until TEXT,
  last_success_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_accounts_upstream ON accounts (upstream_id);

-- 逻辑模型到上游模型映射
CREATE TABLE models (
  logical_name TEXT NOT NULL,
  upstream_id TEXT NOT NULL REFERENCES upstreams(id) ON DELETE CASCADE,
  upstream_model TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  PRIMARY KEY (logical_name, upstream_id)
);

-- 分发 key：仅存 key_hash；mode/policy_json 承自蓝本 gateway_keys
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'friend',
  mode TEXT NOT NULL DEFAULT 'restricted' CHECK (mode IN ('passthrough', 'restricted')),
  policy_json TEXT NOT NULL DEFAULT '{}',
  allowed_models_json TEXT NOT NULL DEFAULT '[]',
  allowed_upstreams_json TEXT NOT NULL DEFAULT '[]',
  quota INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  rate_limit INTEGER,
  expires_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 声明式改写规则（网关 policy 视作一种 scope）
CREATE TABLE rewrite_rules (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'all',
  match_json TEXT NOT NULL DEFAULT '{}',
  action_json TEXT NOT NULL DEFAULT '{}',
  priority INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_rewrite_rules_scope ON rewrite_rules (scope, priority DESC);

-- 生图任务元数据（通用化，不绑 NAI 专列）
CREATE TABLE generations (
  id TEXT PRIMARY KEY,
  key_id TEXT REFERENCES api_keys(id) ON DELETE SET NULL,
  role TEXT NOT NULL,
  upstream_id TEXT REFERENCES upstreams(id) ON DELETE SET NULL,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  params_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  cost_gems INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_generations_created_at ON generations (created_at DESC);

-- 图片资源元数据，二进制在 R2
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  generation_id TEXT REFERENCES generations(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  thumb_r2_key TEXT,
  mime TEXT,
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_assets_generation ON assets (generation_id);

-- 通用计数（面板 key 额度）；与 daily_usage 分工：前者面板、后者网关
CREATE TABLE usage_counters (
  key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (key_id, period)
);
