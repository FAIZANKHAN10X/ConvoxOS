-- ============================================================
-- 072_sequence_paused_status.sql — T4.3 pause/resume
--
-- Adds 'paused' to the enrollment status CHECK so the management
-- UI can pause an enrollment without cancelling it (cancelling
-- is terminal and loses position). Paused rows are excluded from
-- the claim RPC (status='active' predicate) and from the partial
-- unique/claim indexes automatically — no index changes needed.
-- Resuming sets status back to 'active'; a past-due next_run_at
-- then executes on the next sweep (documented, not special-cased).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE sequence_enrollments
  DROP CONSTRAINT IF EXISTS sequence_enrollments_status_check;

ALTER TABLE sequence_enrollments
  ADD CONSTRAINT sequence_enrollments_status_check
  CHECK (status IN ('active', 'paused', 'completed', 'cancelled'));

COMMENT ON CONSTRAINT sequence_enrollments_status_check
  ON sequence_enrollments IS
  'T4.3: paused added for UI pause/resume; terminal states unchanged.';
