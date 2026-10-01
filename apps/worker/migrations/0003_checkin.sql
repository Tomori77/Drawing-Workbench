-- 0003: 自动签到配置与日志（本项目 D1 新建）
-- 依据：docs/docs/01-需求与架构/05-自动签到.md §5.4
PRAGMA foreign_keys = ON;

-- 全局签到时刻表 / 总开关（单行配置，id 恒为 1）
CREATE TABLE checkin_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  weekday_times TEXT NOT NULL DEFAULT '["09:05"]',
  weekend_times TEXT NOT NULL DEFAULT '["10:00"]',
  lease_until TEXT,
  next_run_at TEXT,
  last_attempt_slot TEXT,
  last_success_slot TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  last_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO checkin_settings (id) VALUES (1);

-- 每次签到尝试日志
CREATE TABLE checkin_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  attempted_at TEXT NOT NULL,
  slot TEXT NOT NULL,
  ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
  status_code INTEGER,
  message TEXT
);
CREATE INDEX idx_checkin_logs_attempted ON checkin_logs (attempted_at DESC);
