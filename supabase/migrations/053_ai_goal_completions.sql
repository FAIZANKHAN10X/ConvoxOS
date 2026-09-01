-- 053_ai_goal_completions.sql — Goal completion tracking for Phase 3

CREATE TABLE IF NOT EXISTS ai_goal_completions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_goal_id      uuid NOT NULL REFERENCES ai_goals(id) ON DELETE CASCADE,
  ai_config_id    uuid NOT NULL REFERENCES ai_configs(id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  contact_id      uuid REFERENCES contacts(id) ON DELETE SET NULL,
  completed_at    timestamptz NOT NULL DEFAULT now(),
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ai_goal_completions_account ON ai_goal_completions(account_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_goal_completions_goal ON ai_goal_completions(ai_goal_id);
CREATE INDEX IF NOT EXISTS idx_ai_goal_completions_conversation ON ai_goal_completions(conversation_id);

ALTER TABLE ai_goal_completions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_goal_completions_select ON ai_goal_completions;
CREATE POLICY ai_goal_completions_select ON ai_goal_completions FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_goal_completions_insert ON ai_goal_completions;
CREATE POLICY ai_goal_completions_insert ON ai_goal_completions FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));

-- Allow service_role to insert (agent runtime)
GRANT INSERT, SELECT ON ai_goal_completions TO service_role;
