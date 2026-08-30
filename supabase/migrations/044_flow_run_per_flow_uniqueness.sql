-- ============================================================
-- 044_flow_run_per_flow_uniqueness
--
-- Allow multiple active Flow Runs per contact when they belong
-- to different Flows, but still prevent duplicate runs of the
-- same Flow for one contact (re-entry protection).
--
-- Replaces idx_one_active_run_per_contact (account,contact)
-- with (account,contact,flow_id) so Telegram Flow A + WhatsApp
-- Flow B can both wait for the same contact.
-- ============================================================

DROP INDEX IF EXISTS idx_one_active_run_per_contact;

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_run_per_flow
  ON public.flow_runs (account_id, contact_id, flow_id)
  WHERE status = 'active';

COMMENT ON INDEX idx_one_active_run_per_flow IS
  'One active run per (account,contact,flow) — allows concurrent distinct Flows per contact, blocks duplicate same-Flow re-entry.';
