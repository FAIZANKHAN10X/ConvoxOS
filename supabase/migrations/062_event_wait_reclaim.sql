-- ============================================================
-- 062_event_wait_reclaim.sql — Recover orphaned event-wait claims
--
-- claim_event_wait flips a wait pending→claimed, then the worker
-- resumes the run. If the process dies between those two steps the
-- wait stays `claimed` forever: the timeout ticker only picks up
-- `pending` rows and a later callback reads `claimed` as a
-- duplicate. Reclaim `claimed` rows older than the lease as if
-- pending, so the next callback (n8n retries) resumes the run.
-- The 5-minute lease must exceed the longest executeRun duration.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION claim_event_wait(
  p_account_id uuid,
  p_correlation_key text,
  p_automation_id uuid
)
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
    JOIN automation_runs r ON r.id = w.run_id
    WHERE (w.status = 'pending'
      OR (w.status = 'claimed'
        AND (w.claimed_at IS NULL
          OR w.claimed_at < NOW() - INTERVAL '5 minutes')))
      AND w.kind = 'event'
      AND w.account_id = p_account_id
      AND w.correlation_key = p_correlation_key
      AND r.automation_id = p_automation_id
      AND r.status = 'waiting'
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE automation_waits aw
  SET status = 'claimed',
      claimed_at = NOW()
  FROM picked
  WHERE aw.id = picked.id
  RETURNING aw.*;
END;
$$;

ALTER FUNCTION claim_event_wait(uuid, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION claim_event_wait(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_event_wait(uuid, text, uuid) TO service_role;
