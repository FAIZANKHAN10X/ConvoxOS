-- ============================================================
-- 071_sequence_stop_reason.sql — T4.2 stop-on-reply observability
--
-- Adds cancelled_reason so terminal enrollments distinguish how
-- they ended: 'manual' (explicit cancel), 'reply' (customer
-- replied mid-sequence), 'failed' (step error). Existing rows
-- keep NULL (= legacy/unknown, no backfill needed).
--
-- No CHECK constraint: stop reasons may grow (e.g. future exit
-- conditions) without another migration. No RLS or index
-- changes: terminal rows are already excluded from the claim
-- RPC (status='active' predicate) and partial indexes.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE sequence_enrollments
  ADD COLUMN IF NOT EXISTS cancelled_reason TEXT;

COMMENT ON COLUMN sequence_enrollments.cancelled_reason IS
  'T4.2: how a cancelled enrollment ended (manual|reply|failed). NULL = legacy/unknown.';
