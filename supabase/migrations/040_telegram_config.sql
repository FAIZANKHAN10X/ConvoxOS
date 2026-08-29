-- ============================================================
-- 040_telegram_config
--
-- Minimal Telegram bot configuration for Phase 1 inbound-only.
-- Does NOT create a generic `channels` table, does NOT touch
-- whatsapp_config, messages, contacts, or conversations.
-- One bot per account (mirrors whatsapp_config 017:326), RLS via
-- is_account_member, service-role bypass for webhook PK lookup.
--
-- Phase 1 inbound flow:
--   Admin stores bot_token (encrypted) + bot_username via settings
--   Server generates webhook_secret (32B), stores encrypted, calls
--   Telegram SetWebhook url = /api/telegram/webhook/<telegram_config.id>
--   Inbound Telegram POST carries X-Telegram-Bot-Api-Secret-Token header;
--   webhook authenticates header, resolves account via PK lookup on
--   telegram_config.id (not by scanning bot tokens), then normalizes
--   Update → NormalizedInbound → processNormalizedInbound.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS telegram_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  bot_token_encrypted TEXT NOT NULL,
  bot_username TEXT,
  bot_id BIGINT,
  webhook_secret_encrypted TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected')),
  connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT telegram_config_account_id_key UNIQUE(account_id)
);

ALTER TABLE telegram_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS telegram_config_select ON telegram_config;
DROP POLICY IF EXISTS telegram_config_insert ON telegram_config;
DROP POLICY IF EXISTS telegram_config_update ON telegram_config;
DROP POLICY IF EXISTS telegram_config_delete ON telegram_config;

CREATE POLICY telegram_config_select ON telegram_config FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY telegram_config_insert ON telegram_config FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY telegram_config_update ON telegram_config FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY telegram_config_delete ON telegram_config FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE INDEX IF NOT EXISTS idx_telegram_config_account ON telegram_config(account_id);

DROP TRIGGER IF EXISTS set_updated_at ON telegram_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON telegram_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE telegram_config IS
  'One Telegram bot per account for Phase 1 inbound-only. whatsapp_config remains sole WA store. PK lookup on id authenticates via webhook_secret header; bot_token never scanned.';
COMMENT ON COLUMN telegram_config.bot_token_encrypted IS
  'AES-256-GCM encrypted Telegram bot token (same ENCRYPTION_KEY as whatsapp_config). Never decrypted for webhook routing; only for future outbound.';
COMMENT ON COLUMN telegram_config.webhook_secret_encrypted IS
  'AES-256-GCM encrypted secret sent to Telegram SetWebhook secret_token and verified on inbound as X-Telegram-Bot-Api-Secret-Token.';
