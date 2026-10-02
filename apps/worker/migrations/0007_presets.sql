-- 0007: 配方（参数快照）与画师串（提示词片段），按会话 sid 分区，与画廊 owner_sid 一致。
-- kind='recipe' 存 payload_json（GenerateParams 快照）；kind='artist' 存 content（画师串原文）。
-- 每个 sid 各有一份；内置画师串以 builtin=1 标记，首次为空时种入，可编辑/删除。
CREATE TABLE IF NOT EXISTS presets (
  id TEXT PRIMARY KEY,
  owner_sid TEXT NOT NULL DEFAULT 'owner',
  kind TEXT NOT NULL CHECK (kind IN ('recipe','artist')),
  name TEXT NOT NULL,
  content TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS presets_owner_kind_idx ON presets(owner_sid, kind, updated_at DESC);
