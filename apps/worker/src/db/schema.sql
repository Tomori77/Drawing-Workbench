-- Drawing Workbench minimal schema (D1 / SQLite)
-- sessions 无需建表：会话为 HMAC 签名的无状态 token。

CREATE TABLE IF NOT EXISTS generations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL,
  params_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_generations_created_at
  ON generations (created_at DESC);
