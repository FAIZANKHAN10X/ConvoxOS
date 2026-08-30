-- ============================================================
-- 043_flow_run_trigger_channel
--
-- Snapshot the channel that started a Flow run so
-- Current Conversation stays deterministic after waits and
-- interleaving inbound on another channel.
--
-- Nullable — existing active runs and non-conversational
-- triggers (manual/time/tag) have no channel.
-- Additive, idempotent, no rewrite of existing rows.
-- ============================================================

ALTER TABLE public.flow_runs
  ADD COLUMN IF NOT EXISTS trigger_channel text
    CHECK (trigger_channel IN ('whatsapp', 'telegram'));

COMMENT ON COLUMN public.flow_runs.trigger_channel IS
  'Channel of the inbound NormalizedInbound that started this run; NULL for manual/time/tag triggers.';
