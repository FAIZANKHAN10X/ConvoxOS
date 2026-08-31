-- 051_trigger_evaluations — Truthful stats for P2-F
-- Logs every trigger evaluation (attempted) with matched boolean, for 30d stats

CREATE TABLE IF NOT EXISTS automation_trigger_evaluations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  trigger_type TEXT NOT NULL,
  matched BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trigger_evals_automation ON automation_trigger_evaluations(automation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trigger_evals_account ON automation_trigger_evaluations(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trigger_evals_created ON automation_trigger_evaluations(created_at DESC);

ALTER TABLE automation_trigger_evaluations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "evals_select" ON automation_trigger_evaluations;
CREATE POLICY evals_select ON automation_trigger_evaluations FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS "evals_insert" ON automation_trigger_evaluations;
CREATE POLICY evals_insert ON automation_trigger_evaluations FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
