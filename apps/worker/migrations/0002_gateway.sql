-- 0002: 吸收蓝本的账号池 / 网关计量表
-- 依据：docs/docs/01-需求与架构/03-数据模型.md §5.1、§5.4
PRAGMA foreign_keys = ON;

-- 每 key 每日用量（日界 Asia/Shanghai）
CREATE TABLE daily_usage (
  gateway_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  usage_date TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  gem_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (gateway_key_id, usage_date)
);
CREATE INDEX idx_daily_usage_key_date ON daily_usage (gateway_key_id, usage_date);

-- 并发租约（带过期，过期即不计入 COUNT(*) 过滤，无需清理任务）
CREATE TABLE concurrency_leases (
  lease_id TEXT PRIMARY KEY,
  gateway_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_concurrency_leases_expires ON concurrency_leases (expires_at);

-- 请求级记账
CREATE TABLE request_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  gateway_key_id TEXT,
  account_id TEXT,
  path TEXT NOT NULL,
  mode TEXT NOT NULL,
  status_code INTEGER,
  ok INTEGER NOT NULL DEFAULT 0 CHECK (ok IN (0, 1)),
  duration_ms INTEGER,
  bytes_in INTEGER,
  bytes_out INTEGER,
  cost_gems INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_request_logs_created ON request_logs (created_at DESC);

-- 每次尝试明细
CREATE TABLE request_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  gateway_key_id TEXT,
  account_id TEXT,
  attempt_no INTEGER NOT NULL,
  status_code INTEGER,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_request_attempts_request ON request_attempts (request_id);

-- 账号级冷却（本项目启用，蓝本为死表）
CREATE TABLE account_rate_state (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  failure_count INTEGER NOT NULL DEFAULT 0,
  cooldown_until TEXT,
  last_status INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 运行时键值：账号池 round_robin 游标等
CREATE TABLE runtime_kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
