-- 0004: 个人资料（单例配置，id 恒为 1）
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  nickname TEXT NOT NULL DEFAULT '',
  avatar_color TEXT NOT NULL DEFAULT '#0071e3',
  preferences_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO app_profile (id) VALUES (1);
