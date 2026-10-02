-- 0008: API 密钥明文加密列。key_hash 继续用于鉴权校验，key_enc 以 AES-GCM（HKDF info='apikeys'）保存明文，
-- 使 owner 可在列表中随时重复复制；旧行为 NULL，表示无法再现明文。
ALTER TABLE api_keys ADD COLUMN key_enc TEXT;
