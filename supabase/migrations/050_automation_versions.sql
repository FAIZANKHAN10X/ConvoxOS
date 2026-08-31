-- 050_automation_versions — Version History for P2-F
-- Saved vs Published distinction: Published creates immutable snapshot

CREATE TABLE IF NOT EXISTS automation_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  snapshot JSONB NOT NULL, -- { trigger_type, trigger_config, steps: [{step_type, step_config, position, parent_step_id, branch}] }
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (automation_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_versions_automation ON automation_versions(automation_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_versions_account ON automation_versions(account_id, created_at DESC);

ALTER TABLE automation_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "versions_select" ON automation_versions;
CREATE POLICY versions_select ON automation_versions FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS "versions_insert" ON automation_versions;
CREATE POLICY versions_insert ON automation_versions FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
