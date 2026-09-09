-- ============================================================
-- 057_automation_engine — new automation system (clean slate)
--
-- This is NOT a restoration of 006/010/050/055. Those objects were
-- dropped by 056_retire_automations_flows.sql and stay dead.
--
-- Why each table exists:
--   domain_events          durable CRM/automation outbox
--   automations            account-owned definition + draft + status
--   automation_versions    immutable published snapshots (runs pin here)
--   automation_runs        one execution of a pinned version for a contact
--   automation_run_steps   per-node history, retries, idempotency
--   automation_waits       durable continuation for wait nodes
--
-- Ownership: every row is account-scoped. RLS uses is_account_member.
-- Runtime writes (runs/steps/waits/event claim) use the service role.
-- CRM enqueue of domain_events uses the member-scoped client (INSERT).
--
-- Retention (enforced by purge_automation_history):
--   raw events + steps: 90 days
--   published versions: 10 newest, or younger than 30 days, or pinned
-- ============================================================

-- ------------------------------------------------------------
-- domain_events — durable outbox
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS domain_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- crm = originated from a CRM mutation.
  -- automation = originated from an automation action (loop-aware).
  source TEXT NOT NULL DEFAULT 'crm'
    CHECK (source IN ('crm', 'automation')),
  origin_run_id UUID,
  causation_event_id UUID,
  chain_depth INTEGER NOT NULL DEFAULT 0 CHECK (chain_depth >= 0),
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'processed', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (account_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_domain_events_outbox
  ON domain_events (available_at)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_domain_events_account
  ON domain_events (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_domain_events_contact
  ON domain_events (contact_id, created_at DESC)
  WHERE contact_id IS NOT NULL;

ALTER TABLE domain_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS domain_events_select ON domain_events;
CREATE POLICY domain_events_select ON domain_events
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS domain_events_insert ON domain_events;
CREATE POLICY domain_events_insert ON domain_events
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

-- Members do not claim or mutate the outbox; the worker uses service_role.

-- ------------------------------------------------------------
-- automations — definition + draft
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'disabled')),
  draft_graph JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  draft_trigger JSONB,
  published_version_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automations_account
  ON automations (account_id, status);

ALTER TABLE automations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS automations_select ON automations;
CREATE POLICY automations_select ON automations
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS automations_insert ON automations;
CREATE POLICY automations_insert ON automations
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS automations_update ON automations;
CREATE POLICY automations_update ON automations
  FOR UPDATE USING (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS automations_delete ON automations;
CREATE POLICY automations_delete ON automations
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON automations;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON automations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- automation_versions — immutable published snapshots
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automation_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number >= 1),
  graph JSONB NOT NULL,
  trigger JSONB NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (automation_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_automation_versions_parent
  ON automation_versions (automation_id, version_number DESC);

ALTER TABLE automation_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS automation_versions_select ON automation_versions;
CREATE POLICY automation_versions_select ON automation_versions
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS automation_versions_insert ON automation_versions;
CREATE POLICY automation_versions_insert ON automation_versions
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

-- DELETE allowed for retention; UPDATE is forbidden below.

DROP POLICY IF EXISTS automation_versions_delete ON automation_versions;
CREATE POLICY automation_versions_delete ON automation_versions
  FOR DELETE USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION forbid_automation_version_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'automation_versions are immutable';
END;
$$;

DROP TRIGGER IF EXISTS automation_versions_immutable ON automation_versions;
CREATE TRIGGER automation_versions_immutable
  BEFORE UPDATE ON automation_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_automation_version_update();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'automations_published_version_id_fkey'
  ) THEN
    ALTER TABLE automations
      ADD CONSTRAINT automations_published_version_id_fkey
      FOREIGN KEY (published_version_id)
      REFERENCES automation_versions(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ------------------------------------------------------------
-- automation_runs — pinned to a published version
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automation_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  automation_id UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  version_id UUID NOT NULL REFERENCES automation_versions(id) ON DELETE RESTRICT,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  trigger_event_id UUID REFERENCES domain_events(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'waiting', 'completed', 'failed', 'cancelled')),
  current_node_id TEXT,
  node_executions INTEGER NOT NULL DEFAULT 0,
  attempt INTEGER NOT NULL DEFAULT 1,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT,
  wait_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Default re-entry: one active run per contact + automation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_runs_one_active
  ON automation_runs (automation_id, contact_id)
  WHERE status IN ('queued', 'running', 'waiting');

CREATE INDEX IF NOT EXISTS idx_automation_runs_due
  ON automation_runs (wait_until)
  WHERE status IN ('queued', 'waiting') AND wait_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_automation_runs_account
  ON automation_runs (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_runs_contact
  ON automation_runs (contact_id, created_at DESC);

ALTER TABLE automation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS automation_runs_select ON automation_runs;
CREATE POLICY automation_runs_select ON automation_runs
  FOR SELECT USING (is_account_member(account_id));

-- Runtime inserts/updates go through service_role (RLS bypass).

DROP TRIGGER IF EXISTS set_updated_at ON automation_runs;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON automation_runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'domain_events_origin_run_id_fkey'
  ) THEN
    ALTER TABLE domain_events
      ADD CONSTRAINT domain_events_origin_run_id_fkey
      FOREIGN KEY (origin_run_id)
      REFERENCES automation_runs(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ------------------------------------------------------------
-- automation_run_steps — execution history + idempotency
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automation_run_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL
    CHECK (status IN ('running', 'succeeded', 'failed', 'skipped')),
  idempotency_key TEXT NOT NULL,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  UNIQUE (run_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_automation_run_steps_run
  ON automation_run_steps (run_id, started_at);
CREATE INDEX IF NOT EXISTS idx_automation_run_steps_succeeded
  ON automation_run_steps (run_id, node_id)
  WHERE status = 'succeeded';

ALTER TABLE automation_run_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS automation_run_steps_select ON automation_run_steps;
CREATE POLICY automation_run_steps_select ON automation_run_steps
  FOR SELECT USING (is_account_member(account_id));

-- ------------------------------------------------------------
-- automation_waits — durable continuation (worker must not sleep)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automation_waits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  resume_node_id TEXT,
  resume_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'claimed', 'cancelled')),
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_waits_due
  ON automation_waits (resume_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_automation_waits_run
  ON automation_waits (run_id);

ALTER TABLE automation_waits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS automation_waits_select ON automation_waits;
CREATE POLICY automation_waits_select ON automation_waits
  FOR SELECT USING (is_account_member(account_id));

-- Re-attach tasks.source_automation_id to the NEW automations table.
-- 047 originally referenced the retired table; 056 dropped that FK.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tasks_source_automation_id_fkey'
  ) THEN
    ALTER TABLE tasks
      ADD CONSTRAINT tasks_source_automation_id_fkey
      FOREIGN KEY (source_automation_id)
      REFERENCES automations(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ------------------------------------------------------------
-- Claim helpers (SKIP LOCKED) — service_role only
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_domain_events(p_limit integer)
RETURNS SETOF domain_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT e.id
    FROM domain_events e
    WHERE e.status = 'pending'
      AND e.available_at <= NOW()
    ORDER BY e.created_at
    LIMIT GREATEST(p_limit, 0)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE domain_events d
  SET status = 'processing',
      attempts = d.attempts + 1
  FROM picked
  WHERE d.id = picked.id
  RETURNING d.*;
END;
$$;

ALTER FUNCTION claim_domain_events(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION claim_domain_events(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_domain_events(integer) TO service_role;

CREATE OR REPLACE FUNCTION claim_automation_waits(p_limit integer)
RETURNS SETOF automation_waits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT w.id
    FROM automation_waits w
    WHERE w.status = 'pending'
      AND w.resume_at <= NOW()
    ORDER BY w.resume_at
    LIMIT GREATEST(p_limit, 0)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE automation_waits aw
  SET status = 'claimed',
      claimed_at = NOW()
  FROM picked
  WHERE aw.id = picked.id
  RETURNING aw.*;
END;
$$;

ALTER FUNCTION claim_automation_waits(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION claim_automation_waits(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_automation_waits(integer) TO service_role;

CREATE OR REPLACE FUNCTION claim_due_automation_runs(p_limit integer)
RETURNS SETOF automation_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT r.id
    FROM automation_runs r
    WHERE r.status = 'queued'
      AND (r.wait_until IS NULL OR r.wait_until <= NOW())
    ORDER BY r.created_at
    LIMIT GREATEST(p_limit, 0)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE automation_runs ar
  SET status = 'running',
      wait_until = NULL
  FROM picked
  WHERE ar.id = picked.id
  RETURNING ar.*;
END;
$$;

ALTER FUNCTION claim_due_automation_runs(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION claim_due_automation_runs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_due_automation_runs(integer) TO service_role;

-- ------------------------------------------------------------
-- Retention
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION purge_automation_history()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM domain_events
  WHERE created_at < NOW() - INTERVAL '90 days'
    AND status IN ('processed', 'skipped', 'failed');

  DELETE FROM automation_run_steps
  WHERE started_at < NOW() - INTERVAL '90 days';

  DELETE FROM automation_waits
  WHERE created_at < NOW() - INTERVAL '90 days'
    AND status IN ('claimed', 'cancelled');

  -- Drop old published versions that are not the current published
  -- pointer, not pinned by any run, older than 30 days, and beyond
  -- the newest 10 per automation.
  DELETE FROM automation_versions v
  WHERE v.published_at < NOW() - INTERVAL '30 days'
    AND v.id NOT IN (
      SELECT a.published_version_id
      FROM automations a
      WHERE a.published_version_id IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM automation_runs r WHERE r.version_id = v.id
    )
    AND v.id NOT IN (
      SELECT kept.id
      FROM (
        SELECT av.id,
          row_number() OVER (
            PARTITION BY av.automation_id
            ORDER BY av.version_number DESC
          ) AS rn
        FROM automation_versions av
      ) kept
      WHERE kept.rn <= 10
    );
END;
$$;

ALTER FUNCTION purge_automation_history() OWNER TO postgres;
REVOKE ALL ON FUNCTION purge_automation_history() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_automation_history() TO service_role;
