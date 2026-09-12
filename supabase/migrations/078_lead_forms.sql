-- ============================================================
-- 078_lead_forms.sql — T6.1 minimal lead-capture forms
--
-- lead_forms: one row per capture form. fields is a JSONB array of
-- {key, label, type, required} where type is one of
-- name|phone|email|company|message. Phone is always present and
-- required (contacts are phone-keyed; a phoneless lead cannot enter
-- automation). public_token_hash is the SHA-256 of the public
-- bearer token (same scheme as inbound hooks) — the raw token is
-- shown once at creation and never stored.
--
-- form_submissions: one row per validated submit. (form_id,
-- submission_key) is unique when the client supplies a key, so
-- double-submits collapse deterministically. attribution carries
-- utm_source/medium/campaign + referrer as supplied.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS lead_forms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  public_token_hash TEXT NOT NULL UNIQUE,
  fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_forms_account
  ON lead_forms (account_id, created_at DESC);

ALTER TABLE lead_forms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_forms_select ON lead_forms;
CREATE POLICY lead_forms_select ON lead_forms
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS lead_forms_insert ON lead_forms;
CREATE POLICY lead_forms_insert ON lead_forms
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS lead_forms_update ON lead_forms;
CREATE POLICY lead_forms_update ON lead_forms
  FOR UPDATE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS lead_forms_delete ON lead_forms;
CREATE POLICY lead_forms_delete ON lead_forms
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON lead_forms;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON lead_forms
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON COLUMN lead_forms.public_token_hash IS
  'T6.1: SHA-256 of the public form token; raw token shown once, never stored.';
COMMENT ON COLUMN lead_forms.fields IS
  'T6.1: [{key,label,type,required}]; phone always present and required.';

CREATE TABLE IF NOT EXISTS form_submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  form_id UUID NOT NULL REFERENCES lead_forms(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  values JSONB NOT NULL DEFAULT '{}'::jsonb,
  attribution JSONB NOT NULL DEFAULT '{}'::jsonb,
  submission_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_form_submissions_form
  ON form_submissions (form_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_form_submissions_key
  ON form_submissions (form_id, submission_key)
  WHERE submission_key IS NOT NULL;

ALTER TABLE form_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS form_submissions_select ON form_submissions;
CREATE POLICY form_submissions_select ON form_submissions
  FOR SELECT USING (is_account_member(account_id));

-- Runtime inserts go through service_role (public submit route);
-- dashboard reads stay member-scoped.
