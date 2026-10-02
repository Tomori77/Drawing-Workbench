-- 0006: 朋友分享密码实体化（D1 可增删改）+ 画廊分区 + 字节配额
-- owner 仍使用 Worker secret OWNER_PASSWORD，不落库。
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS share_passwords (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'friend',
  quota_bytes INTEGER NOT NULL DEFAULT 524288000, -- 500MB
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 画廊分区与字节统计；旧数据统一归 owner。
ALTER TABLE assets ADD COLUMN owner_sid TEXT NOT NULL DEFAULT 'owner';
ALTER TABLE assets ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE generations ADD COLUMN owner_sid TEXT NOT NULL DEFAULT 'owner';
CREATE INDEX IF NOT EXISTS assets_owner_sid_idx ON assets(owner_sid);
