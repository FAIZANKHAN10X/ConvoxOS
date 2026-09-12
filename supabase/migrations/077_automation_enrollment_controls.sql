-- ============================================================
-- 077_automation_enrollment_controls.sql — T5.4 enrollment controls
--
-- automations.reentry_policy: 'repeat' (default, current behavior —
-- enroll whenever no active run) vs 'once' (a contact enrolls at
-- most once ever; any prior run blocks re-enrollment).
--
-- automations.stop_on_reply: when true, an inbound message from the
-- contact cancels their active runs for this automation before new
-- matches enroll (reply wins over enrollment, deterministically).
--
-- automation_enrollment_skips: one row per skipped enrollment
-- (active-run conflict, re-entry block). Enrolled runs are already
-- recorded in automation_runs; this table completes the
-- deterministic decision trail for the debugger (T8.6).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE automations
  ADD COLUMN IF NOT EXISTS reentry_policy TEXT NOT NULL DEFAULT 'repeat'
    CHECK (reentry_policy IN ('once', 'repeat'));

ALTER TABLE automations
  ADD COLUMN IF NOT EXISTS stop_on_reply BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN automations.reentry_policy IS
  'T5.4: once = contact enrolls at most once ever; repeat = enroll whenever no active run.';
COMMENT ON COLUMN automations.stop_on_reply IS
  'T5.4: inbound reply cancels the contact''s active runs before new enrollment.';

CREATE TABLE IF NOT EXISTS automation_enrollment_skips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  event_id UUID REFERENCES domain_events(id) ON DELETE SET NULL,
  reason TEXT NOT NULL
    CHECK (reason IN ('active_run', 'already_enrolled')),
  existing_run_id UUID REFERENCES automation_runs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enrollment_skips_automation_contact
  ON automation_enrollment_skips (automation_id, contact_id, created_at DESC);

ALTER TABLE automation_enrollment_skips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS enrollment_skips_select ON automation_enrollment_skips;
CREATE POLICY enrollment_skips_select ON automation_enrollment_skips
  FOR SELECT USING (is_account_member(account_id));

-- Runtime inserts go through service_role (RLS bypass).
