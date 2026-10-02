-- 0005: 账号图片限额全局计数（窗口内成功张数，工作台与网关共享）
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS account_usage (
  account_id TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  image_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
