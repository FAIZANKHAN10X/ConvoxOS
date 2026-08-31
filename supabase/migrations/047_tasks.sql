-- ============================================================
-- 047_tasks — Tasks CRM primitive for automation
-- Idempotent — safe to run multiple times.
-- Follows conventions from 001_initial_schema.sql + 017_account_sharing.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed')),
  due_at TIMESTAMPTZ,
  source_automation_id UUID REFERENCES automations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for hot paths: account-scoped listing, contact's tasks, assignee's open tasks, due date ordering
CREATE INDEX IF NOT EXISTS idx_tasks_account ON tasks(account_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_contact ON tasks(contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_at) WHERE due_at IS NOT NULL;

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tasks_select" ON tasks;
CREATE POLICY tasks_select ON tasks FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS "tasks_insert" ON tasks;
CREATE POLICY tasks_insert ON tasks FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS "tasks_update" ON tasks;
CREATE POLICY tasks_update ON tasks FOR UPDATE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS "tasks_delete" ON tasks;
CREATE POLICY tasks_delete ON tasks FOR DELETE USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON tasks;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
