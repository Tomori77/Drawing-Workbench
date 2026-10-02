-- 0009: 图片公开标记。公开图仍存原 owner_sid（配额与归属不变），所有已登录用户可读。
ALTER TABLE assets ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS assets_public_idx ON assets(is_public, created_at DESC);
