-- ============================================================
-- 060_inbound_hook_token_enc.sql
--
-- 058 hashed the inbound bearer token (lookup-only). The builder
-- needs to re-show the webhook URL without rotating. Store an
-- AES-GCM copy of the token alongside the hash; HMAC secret_enc
-- stays shown-once.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE automation_inbound_hooks
  ADD COLUMN IF NOT EXISTS token_enc text;
