-- ============================================================
-- 081_email_templates.sql — T7.3 reusable email templates
--
-- email_templates: account-scoped subject + body templates with
-- {{variable}} placeholders resolved from the automation run scope
-- at send time (same interpolate engine as the other nodes).
-- Names unique per account for stable picker references.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS email_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL DEFAULT '',
  body_html TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT email_templates_account_name_key UNIQUE(account_id, name)
);

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_templates_select ON email_templates;
CREATE POLICY email_templates_select ON email_templates
  FOR SELECT USING (is_account_member(account_id));
DROP POLICY IF EXISTS email_templates_insert ON email_templates;
CREATE POLICY email_templates_insert ON email_templates
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS email_templates_update ON email_templates;
CREATE POLICY email_templates_update ON email_templates
  FOR UPDATE USING (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS email_templates_delete ON email_templates;
CREATE POLICY email_templates_delete ON email_templates
  FOR DELETE USING (is_account_member(account_id, 'admin'));

CREATE INDEX IF NOT EXISTS idx_email_templates_account
  ON email_templates (account_id, name);

DROP TRIGGER IF EXISTS set_updated_at ON email_templates;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON email_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE email_templates IS
  'T7.3: reusable email subject/body templates; {{variables}} resolve from the automation run scope.';
