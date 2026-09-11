-- ============================================================
-- 063_runtime_claim_recovery.sql — Reclaim orphaned waits/runs +
-- stable message idempotency key
--
-- 1) claim_automation_waits reclaims stale `claimed` rows (any kind)
--    whose timeout is due. Previously only `pending` rows were
--    picked: a crash between claim and resume orphaned the wait
--    forever. The 5-minute lease mirrors claim_event_wait (062) and
--    must exceed the longest executeRun duration.
--
-- 2) claim_due_automation_runs reclaims stale `running` runs whose
--    heartbeat (updated_at, touched after every engine node) is
--    older than 10 minutes — i.e. the process died mid-executeRun.
--    Healthy ticks update far inside the lease (route maxDuration
--    60s), so reclaim never steals a live run. Replay is safe via
--    the engine's succeeded-step skip.
--
-- 3) messages.idempotency_key lets automation resends short-circuit
--    before calling the provider: a retry after a partial multi-
--    block send reuses the already-persisted row instead of
--    double-sending. NULL for manual/dashboard sends (unchanged).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

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
    WHERE (w.status = 'pending'
      OR (w.status = 'claimed'
        AND (w.claimed_at IS NULL
          OR w.claimed_at < NOW() - INTERVAL '5 minutes')))
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
    WHERE (r.status = 'queued'
      AND (r.wait_until IS NULL OR r.wait_until <= NOW()))
      OR (r.status = 'running'
        AND r.updated_at < NOW() - INTERVAL '10 minutes')
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

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_idempotency_key
  ON messages (conversation_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
