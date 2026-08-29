-- ============================================================
-- 041_channel_provenance_nullable
--
-- Phase 1 inbound boundary — provider provenance on messages + TG
-- identity on contacts. Approved corrections:
--   * contacts.phone becomes nullable (no synthetic phones)
--   * Telegram identity is (account_id, telegram_user_id) where
--     telegram_user_id is stable; telegram_chat_id is routing.
--   * messages.channel TEXT carries provider; conversations remain
--     unified (no Conversation.channel per approval).
--   * whatsapp_config, broadcast, template lifecycle, send-message,
--     meta-api untouched.
--   * Channel is nullable with DEFAULT 'whatsapp' for zero-downtime;
--     042 will enforce NOT NULL after verification.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- 1) messages.channel — provider provenance
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS channel TEXT
  DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'telegram'));

-- Backfill existing rows created before column existed (ADD COLUMN DEFAULT
-- backfills via metadata in PG11+, but explicit UPDATE covers pre-041 rows
-- if DEFAULT was not applied by storage engine).
UPDATE messages SET channel = 'whatsapp' WHERE channel IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_channel ON messages(conversation_id, channel);

COMMENT ON COLUMN messages.channel IS
  'Provider provenance for Phase 1. ''whatsapp'' for Meta Cloud API, ''telegram'' for Telegram Bot API. Conversations remain unified per (account_id,contact_id); channel lives only on messages. Nullable with DEFAULT whatsapp for zero-downtime; enforced NOT NULL in 042.';

-- 2) contacts.phone becomes nullable — preserves WA phone dedupe verbatim
--    WA rows keep phone NOT NULL values; TG-only contacts store telegram_user_id.
ALTER TABLE contacts ALTER COLUMN phone DROP NOT NULL;

COMMENT ON COLUMN contacts.phone IS
  'WhatsApp identity; nullable after 041 for Telegram-only contacts. WA dedupe UNIQUE(account_id,phone_normalized) WHERE <>'''' unchanged.';

-- contacts.phone_normalized is GENERATED ALWAYS AS (regexp_replace(phone,'\D','','g')) STORED
-- null phone → null normalized, excluded from WA partial index, as intended.

-- 3) Telegram-native identity columns
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS telegram_user_id BIGINT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS telegram_username TEXT;

COMMENT ON COLUMN contacts.telegram_user_id IS
  'Telegram stable identity for channel-aware dedupe: UNIQUE(account_id, telegram_user_id) WHERE NOT NULL. WA phone dedupe untouched.';
COMMENT ON COLUMN contacts.telegram_chat_id IS
  'Telegram routing/address field (chat.id); not identity, updated on each inbound if changed.';
COMMENT ON COLUMN contacts.telegram_username IS
  'Telegram optional metadata (username without @); not identity.';

-- Channel-aware TG uniqueness — does NOT touch WA idx_contacts_account_phone_normalized
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_telegram_user_id
  ON contacts(account_id, telegram_user_id) WHERE telegram_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_telegram_chat_id
  ON contacts(telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;

-- No change to idx_conversations_account_contact, idx_messages_conversation_message_id,
-- whatsapp_config, broadcast_recipients, or template tables per approval.
