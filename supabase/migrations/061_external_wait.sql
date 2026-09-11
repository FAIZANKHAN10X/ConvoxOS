-- ============================================================
-- 061_external_wait.sql — Same-run webhook continuation
--
-- Time waits already live in automation_waits. This adds an event
-- wait kind so a run can pause until a correlated inbound webhook
-- arrives, then resume the SAME run instead of starting another.
--
-- Correlation key is the run id (already sent outbound as run_id).
-- claim_event_wait is atomic and account + automation scoped.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE automation_waits
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'time';

ALTER TABLE automation_waits
  DROP CONSTRAINT IF EXISTS automation_waits_kind_check;
ALTER TABLE automation_waits
  ADD CONSTRAINT automation_waits_kind_check
  CHECK (kind IN ('time', 'event'));

ALTER TABLE automation_waits
  ADD COLUMN IF NOT EXISTS correlation_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_waits_event_correlation
  ON automation_waits (account_id, correlation_key)
  WHERE status = 'pending' AND kind = 'event' AND correlation_key IS NOT NULL;

-- Time waits and timed-out event waits. Event waits with a future
-- resume_at stay pending until claim_event_wait or the timeout.
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
    WHERE w.status = 'pending'
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
