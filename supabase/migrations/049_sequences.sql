-- 049_sequences — First-class Sequences for P2-C
-- Idempotent

CREATE TABLE IF NOT EXISTS sequences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sequences_account ON sequences(account_id, is_active);

ALTER TABLE sequences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sequences_select" ON sequences;
CREATE POLICY sequences_select ON sequences FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS "sequences_insert" ON sequences;
CREATE POLICY sequences_insert ON sequences FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS "sequences_update" ON sequences;
CREATE POLICY sequences_update ON sequences FOR UPDATE USING (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS "sequences_delete" ON sequences;
CREATE POLICY sequences_delete ON sequences FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON sequences;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON sequences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS sequence_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sequence_id UUID NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  step_type TEXT NOT NULL CHECK (step_type IN ('send_message','send_buttons','send_list','wait')),
  step_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sequence_steps_seq_pos ON sequence_steps(sequence_id, position);

ALTER TABLE sequence_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sequence_steps_select" ON sequence_steps;
CREATE POLICY sequence_steps_select ON sequence_steps FOR SELECT USING (
  EXISTS (SELECT 1 FROM sequences s WHERE s.id = sequence_steps.sequence_id AND is_account_member(s.account_id))
);
DROP POLICY IF EXISTS "sequence_steps_modify" ON sequence_steps;
CREATE POLICY sequence_steps_modify ON sequence_steps FOR ALL USING (
  EXISTS (SELECT 1 FROM sequences s WHERE s.id = sequence_steps.sequence_id AND is_account_member(s.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM sequences s WHERE s.id = sequence_steps.sequence_id AND is_account_member(s.account_id, 'agent'))
);

CREATE TABLE IF NOT EXISTS sequence_enrollments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sequence_id UUID NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  current_position INTEGER NOT NULL DEFAULT 0,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  UNIQUE (sequence_id, contact_id, status) DEFERRABLE INITIALLY DEFERRED
);

-- Partial unique to prevent duplicate active enrollments, but allow multiple completed/cancelled
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_enrollment_per_contact ON sequence_enrollments(sequence_id, contact_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_enrollments_next_run ON sequence_enrollments(next_run_at) WHERE status = 'active' AND next_run_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_enrollments_account ON sequence_enrollments(account_id, status);

ALTER TABLE sequence_enrollments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "enrollments_select" ON sequence_enrollments;
CREATE POLICY enrollments_select ON sequence_enrollments FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS "enrollments_modify" ON sequence_enrollments;
CREATE POLICY enrollments_modify ON sequence_enrollments FOR ALL USING (is_account_member(account_id, 'agent')) WITH CHECK (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON sequence_enrollments;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON sequence_enrollments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
