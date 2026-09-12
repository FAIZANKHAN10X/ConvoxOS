-- ============================================================
-- 082_sequence_email_step.sql — T7.5 email sequence steps
--
-- sequence_steps.step_type gains 'send_email' (subject + text,
-- always the email channel). Additive CHECK rewrite only; no row
-- changes. Enrollment, waits, scheduler, stop-on-reply, and
-- idempotency are untouched — the existing engine executes the
-- new step through the channel socket.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'sequence_steps'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%send_message%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE sequence_steps DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE sequence_steps
  ADD CONSTRAINT sequence_steps_step_type_check
  CHECK (step_type IN ('send_message','send_buttons','send_list','wait','send_email'));
