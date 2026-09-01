-- ============================================================
-- 034_ai_agent_phase2.sql — Phase 2: Agent Configuration Model + Goals
--
-- Introduces:
--   1. ai_configs.status         — single canonical lifecycle (draft/paused/live)
--      with backfill from existing is_active/auto_reply_enabled booleans.
--   2. ai_configs.identity       — structured agent identity (name/role/description)
--   3. ai_configs.behaviour      — structured behaviour (tone/responseLength/instructions)
--   4. ai_goals                 — first-class goals per agent
--
-- Migration strategy (compatibility):
--   - Add new columns with defaults, keep old booleans for now.
--   - Backfill status from booleans (mapping in spec §4).
--   - Keep old columns populated via trigger so both representations stay in sync
--     during the transition — old runtime consumers continue to work until
--     they are migrated to status.
-- ============================================================

-- 1. Status: single canonical lifecycle
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'paused', 'live'));

-- Backfill from existing booleans
UPDATE ai_configs
SET status = CASE
  WHEN is_active = true AND auto_reply_enabled = true THEN 'live'
  WHEN is_active = true AND auto_reply_enabled = false THEN 'paused'
  ELSE 'draft'
END
WHERE status = 'draft'
  AND (is_active IS NOT NULL OR auto_reply_enabled IS NOT NULL);

-- Keep booleans in sync via trigger (bidirectional compatibility during transition)
CREATE OR REPLACE FUNCTION public.sync_ai_configs_status()
RETURNS TRIGGER AS $$
BEGIN
  -- If status changed, sync booleans to match
  IF NEW.status IS DISTINCT FROM OLD.status OR OLD.status IS NULL THEN
    CASE NEW.status
      WHEN 'draft' THEN
        NEW.is_active := false;
        NEW.auto_reply_enabled := false;
      WHEN 'paused' THEN
        NEW.is_active := true;
        NEW.auto_reply_enabled := false;
      WHEN 'live' THEN
        NEW.is_active := true;
        NEW.auto_reply_enabled := true;
    END CASE;
  -- If booleans changed directly (old API writes), sync status
  ELSIF (NEW.is_active IS DISTINCT FROM OLD.is_active) OR (NEW.auto_reply_enabled IS DISTINCT FROM OLD.auto_reply_enabled) THEN
    IF NEW.is_active = true AND NEW.auto_reply_enabled = true THEN
      NEW.status := 'live';
    ELSIF NEW.is_active = true AND NEW.auto_reply_enabled = false THEN
      NEW.status := 'paused';
    ELSE
      NEW.status := 'draft';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_configs_status_sync ON ai_configs;
CREATE TRIGGER ai_configs_status_sync
  BEFORE INSERT OR UPDATE ON ai_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_ai_configs_status();

-- 2. Identity: structured agent identity (name/role/description)
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS identity jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Backfill identity from existing name-like data where possible (none today, keep {})

-- 3. Behaviour: structured behaviour config
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS behaviour jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Migrate existing system_prompt into behaviour.instructions if present
UPDATE ai_configs
SET behaviour = jsonb_build_object('instructions', system_prompt)
WHERE system_prompt IS NOT NULL
  AND system_prompt <> ''
  AND (behaviour = '{}'::jsonb OR behaviour IS NULL);

-- 4. Goals: first-class goals per agent
CREATE TABLE IF NOT EXISTS ai_goals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_config_id  uuid NOT NULL REFERENCES ai_configs(id) ON DELETE CASCADE,
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name          text NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('capture_lead', 'share_link', 'custom')),
  description   text,
  params        jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority      integer NOT NULL DEFAULT 0,
  enabled       boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_goals_ai_config_priority
  ON ai_goals(ai_config_id, priority ASC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_ai_goals_account
  ON ai_goals(account_id);

ALTER TABLE ai_goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_goals_select ON ai_goals;
CREATE POLICY ai_goals_select ON ai_goals FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_goals_insert ON ai_goals;
CREATE POLICY ai_goals_insert ON ai_goals FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_goals_update ON ai_goals;
CREATE POLICY ai_goals_update ON ai_goals FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_goals_delete ON ai_goals;
CREATE POLICY ai_goals_delete ON ai_goals FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_ai_goals_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ai_goals_updated_at ON ai_goals;
CREATE TRIGGER ai_goals_updated_at
  BEFORE UPDATE ON ai_goals
  FOR EACH ROW
  EXECUTE FUNCTION public.update_ai_goals_updated_at();

-- Also keep ai_configs.updated_at fresh for identity/behaviour/status writes (already exists)
