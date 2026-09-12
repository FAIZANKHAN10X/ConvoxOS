-- ============================================================
-- 080_email_channel.sql — T7.1 Email plug module foundation
--
-- Provider decision (per source-of-truth, before T7.2): Resend.
-- Single API key, plain REST (no SDK dependency), native
-- Idempotency-Key send header, Svix-signed webhooks covering
-- delivery/bounce/complaint/open/click AND inbound receipt.
-- SES rejected: needs SNS+S3 plumbing (speculative infra).
-- Mailgun rejected: heavier setup for the same CRM surface.
--
-- email_config: one row per account (mirrors 040 telegram_config).
-- The raw API key is validated against Resend, then stored
-- encrypted; webhook_secret is generated server-side and must be
-- pasted into the Resend dashboard alongside the per-config
-- webhook URL (/api/email/webhook/<id>).
--
-- messages.channel gains 'email' (provider provenance stays on
-- messages; conversations remain unified). messages.subject stores
-- email subjects (NULL for chat channels).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS email_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  api_key_encrypted TEXT NOT NULL,
  from_address TEXT NOT NULL,
  from_name TEXT,
  webhook_secret_encrypted TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('connected', 'disconnected')),
  connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT email_config_account_id_key UNIQUE(account_id)
);

ALTER TABLE email_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_config_select ON email_config;
CREATE POLICY email_config_select ON email_config FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS email_config_insert ON email_config;
CREATE POLICY email_config_insert ON email_config FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS email_config_update ON email_config;
CREATE POLICY email_config_update ON email_config FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS email_config_delete ON email_config;
CREATE POLICY email_config_delete ON email_config FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE INDEX IF NOT EXISTS idx_email_config_account ON email_config(account_id);

DROP TRIGGER IF EXISTS set_updated_at ON email_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON email_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE email_config IS
  'T7.1: one Resend-backed email identity per account. API key encrypted at rest; per-config webhook URL + secret mirror the telegram pattern.';

-- messages.channel: extend provenance CHECK to email.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'messages'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%whatsapp%telegram%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE messages DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE messages
  ADD CONSTRAINT messages_channel_check
  CHECK (channel IN ('whatsapp', 'telegram', 'email'));

COMMENT ON COLUMN messages.channel IS
  'Provider provenance. whatsapp (Meta), telegram (Bot API), email (Resend). Conversations remain unified.';

-- messages.subject: email subjects (NULL for chat channels).
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS subject TEXT;

COMMENT ON COLUMN messages.subject IS
  'T7.1: email subject line; NULL for whatsapp/telegram messages.';

-- flow_runs.trigger_channel: same provenance extension (legacy
-- runs table, if present; additive only).
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'flow_runs') THEN
    RETURN;
  END IF;
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'flow_runs'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%whatsapp%telegram%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE flow_runs DROP CONSTRAINT %I', constraint_name);
    ALTER TABLE flow_runs
      ADD CONSTRAINT flow_runs_trigger_channel_check
      CHECK (trigger_channel IN ('whatsapp', 'telegram', 'email'));
  END IF;
END $$;
