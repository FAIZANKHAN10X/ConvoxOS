-- ============================================================
-- 069_conversation_delta_index.sql — T1.6 resync delta support
--
-- Resync fetches conversations changed since the last load
-- (updated_at >= watermark) instead of re-reading the whole
-- list. This composite index serves that window query under
-- the account scope. bump_conversation_on_inbound maintains
-- updated_at on every inbound message, so the watermark
-- advances with real activity.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_conversations_account_updated
  ON conversations (account_id, updated_at DESC);
