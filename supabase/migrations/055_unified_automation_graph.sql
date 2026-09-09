-- ============================================================
-- 055_unified_automation_graph — Phase 1 foundation
--
-- Establishes ONE canonical automation graph per
-- docs/research/AUTOMATION_UNIFICATION_MIGRATION_PLAN.md Phase 0.
--
-- What this migration does:
--   1. `flows.trigger_envelope JSONB` — array of triggers OR (Manychat envelope).
--      Backfilled from legacy `trigger_type/trigger_config` for existing rows.
--   2. `flows.entry_node_key` alias semantics clarified — keep column `entry_node_id`
--      (string → flow_nodes.node_key) for compat; no rename to avoid breaking saves.
--   3. Expand `flow_nodes.node_type` CHECK to unified Manychat taxonomy
--      while keeping legacy values for backward compat during migration window.
--      New canonical: message, action, condition, randomizer, smart_delay,
--      start_automation, ai_step, handoff, end  plus legacy aliases
--      (send_message, send_buttons, send_list, send_media, collect_input,
--      set_tag, wait, start, http_fetch).
--   4. `flow_runs` pending window columns: pending_kind, pending_until,
--      pending_context JSONB — for Smart Delay window/TZ + DataCollection timeout.
--   5. `contact_randomizer_buckets` — sticky bucket per (account,contact,flow,node).
--   6. `preview_sessions` — scaffold for split preview (In Manychat vs In messengers).
--   7. `automations.migrated_to_flow_id` — tracks import idempotency, FK flows.
--
-- Idempotent — safe to run multiple times (IF NOT EXISTS guards).
-- NOT destructive — no DROP of legacy columns/tables.
-- ============================================================

-- ============================================================
-- 1. flows.trigger_envelope
-- ============================================================

ALTER TABLE flows
  ADD COLUMN IF NOT EXISTS trigger_envelope JSONB;

-- GIN index for trigger kind lookups at dispatch time (OR filtering)
CREATE INDEX IF NOT EXISTS idx_flows_trigger_envelope_gin
  ON flows USING GIN (trigger_envelope);

-- Backfill: wrap legacy single trigger into envelope array with generated id
UPDATE flows
SET trigger_envelope = jsonb_build_object(
  'triggers', jsonb_build_array(
    jsonb_build_object(
      'id', gen_random_uuid()::text,
      'kind', COALESCE(trigger_type, 'manual'),
      'channel', COALESCE(trigger_config->>'channel', 'any'),
      'config', COALESCE(trigger_config, '{}'::jsonb),
      'enabled', true
    )
  )
)
WHERE trigger_envelope IS NULL;

COMMENT ON COLUMN flows.trigger_envelope IS
  'Unified trigger envelope — OR of N triggers sharing entry_node_id. Legacy trigger_type/trigger_config kept as compat (represents first trigger) until bake-out.';

-- Expand legacy flows.trigger_type CHECK (was only keyword/first_inbound_message/manual) to
-- allow all UnifiedTriggerKind values so graph-service legacy mirror (first trigger kind) does not violate CHECK
ALTER TABLE flows DROP CONSTRAINT IF EXISTS flows_trigger_type_check;
ALTER TABLE flows ADD CONSTRAINT flows_trigger_type_check
  CHECK (trigger_type IN (
    'keyword', 'first_inbound_message', 'manual',
    'new_message_received', 'keyword_match', 'new_contact_created', 'conversation_assigned',
    'tag_added', 'tag_removed', 'time_based', 'interactive_reply',
    'contact_changed', 'note_added', 'task_added', 'customer_replied',
    'opportunity_created', 'pipeline_stage_changed', 'inbound_webhook',
    'instagram_comments', 'facebook_comments', 'story_reply', 'story_mention', 'ad_click', 'qr_scan'
  ));

-- ============================================================
-- 2. flow_nodes.node_type — unify + keep legacy aliases
-- ============================================================

ALTER TABLE flow_nodes DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;

ALTER TABLE flow_nodes ADD CONSTRAINT flow_nodes_node_type_check
  CHECK (node_type IN (
    -- NEW canonical (Manychat Pro target)
    'message',
    'action',
    'condition',
    'randomizer',
    'smart_delay',
    'start_automation',
    'ai_step',
    'handoff',
    'end',
    -- Legacy aliases kept for Phase 0/1 compat (flows created via old builder)
    'start',
    'send_message',
    'send_buttons',
    'send_list',
    'send_media',
    'collect_input',
    'set_tag',
    'wait',
    'http_fetch'
  ));

COMMENT ON COLUMN flow_nodes.node_type IS
  'Canonical Manychat types: message/action/condition/randomizer/smart_delay/start_automation/ai_step/handoff/end. Legacy send_* / set_tag / wait / collect_input / http_fetch kept as aliases during Phase 1 migration window.';

-- ============================================================
-- 3. flow_runs pending window columns
-- ============================================================

ALTER TABLE flow_runs
  ADD COLUMN IF NOT EXISTS pending_kind TEXT
    CHECK (pending_kind IN ('wait','smartDelayDuration','smartDelayDate','dataCollectionTimeout','aiTurn'));

ALTER TABLE flow_runs
  ADD COLUMN IF NOT EXISTS pending_until TIMESTAMPTZ;

ALTER TABLE flow_runs
  ADD COLUMN IF NOT EXISTS pending_context JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_flow_runs_pending_until
  ON flow_runs(pending_until) WHERE pending_until IS NOT NULL AND status = 'active';

COMMENT ON COLUMN flow_runs.pending_kind IS
  'Kind of pending suspension for unified Smart Delay / Wait / DataCollection / AI turn. Null when not suspended.';
COMMENT ON COLUMN flow_runs.pending_until IS 'Resume time for smartDelay/dataCollection. Null when not suspended.';
COMMENT ON COLUMN flow_runs.pending_context IS 'Runtime windowSpec/contactTzElseAccount/varsSnapshot for resume re-check.';

-- ============================================================
-- 4. contact_randomizer_buckets — sticky per (account,contact,flow,node)
-- ============================================================

CREATE TABLE IF NOT EXISTS contact_randomizer_buckets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  node_key TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, contact_id, flow_id, node_key)
);

CREATE INDEX IF NOT EXISTS idx_randomizer_buckets_contact_flow
  ON contact_randomizer_buckets(account_id, contact_id, flow_id);

ALTER TABLE contact_randomizer_buckets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own buckets" ON contact_randomizer_buckets;
CREATE POLICY "Users see own buckets" ON contact_randomizer_buckets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM flows f
      WHERE f.id = contact_randomizer_buckets.flow_id
        AND f.user_id = auth.uid()
    )
  );
-- Writes via service-role only (engine), no INSERT/UPDATE/DELETE policy for browser

-- ============================================================
-- 5. preview_sessions — scaffold for split preview (Phase 1 only)
-- ============================================================

CREATE TABLE IF NOT EXISTS preview_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  flow_id UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  created_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('inmanychat','inmessengers')),
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  masked BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_preview_sessions_flow
  ON preview_sessions(flow_id, created_at DESC);

ALTER TABLE preview_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own preview sessions" ON preview_sessions;
CREATE POLICY "Users manage own preview sessions" ON preview_sessions FOR ALL
  USING (auth.uid() = created_by_user_id);

-- ============================================================
-- 6. automations.migrated_to_flow_id — import idempotency
-- ============================================================

ALTER TABLE automations
  ADD COLUMN IF NOT EXISTS migrated_to_flow_id UUID REFERENCES flows(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_automations_migrated_to_flow
  ON automations(migrated_to_flow_id) WHERE migrated_to_flow_id IS NOT NULL;

COMMENT ON COLUMN automations.migrated_to_flow_id IS
  'Set when this automation was imported into the unified flows graph via the Phase 1 importer. Enables idempotent re-import and rollback (SET is_active=false instead of DELETE).';

-- ============================================================
-- 7. flows.version — for future publish snapshots
-- ============================================================

ALTER TABLE flows
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- ============================================================
-- 8. Realtime publication — preview_sessions does not need pub;
--    contact_randomizer_buckets no.
-- ============================================================
