-- 045_flow_wait — first-class Wait for conversational Flows
-- Reuses automation_pending_executions for timed suspension.
-- Additive, backward compatible: existing rows keep automation_id NOT NULL
-- semantics via check; new flow waits use flow_run_id.

ALTER TABLE automation_pending_executions
  ALTER COLUMN automation_id DROP NOT NULL;

ALTER TABLE automation_pending_executions
  ADD COLUMN IF NOT EXISTS flow_run_id UUID REFERENCES flow_runs(id) ON DELETE CASCADE;

-- At least one target must be set (automation vs flow)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_pending_target'
  ) THEN
    ALTER TABLE automation_pending_executions
      ADD CONSTRAINT chk_pending_target
      CHECK (automation_id IS NOT NULL OR flow_run_id IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pending_flow_run
  ON automation_pending_executions(flow_run_id) WHERE flow_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pending_flow_due
  ON automation_pending_executions(run_at) WHERE status = 'pending' AND flow_run_id IS NOT NULL;

COMMENT ON COLUMN automation_pending_executions.flow_run_id IS
  'For Flow Waits: the flow_runs.id that is suspended. Null for classic Automation waits.';
