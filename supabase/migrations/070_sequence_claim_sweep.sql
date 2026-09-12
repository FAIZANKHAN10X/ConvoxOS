-- ============================================================
-- 070_sequence_claim_sweep.sql — T4.1 atomic sequence claim
--
-- resumeDueSequenceEnrollments() previously did a plain SELECT of
-- due enrollments: two overlapping worker ticks (cron + manual
-- kick, or slow ticks) could execute the same scheduled step
-- twice. This RPC claims due rows atomically, reusing the exact
-- pattern of the automation claim functions (061/062/063):
-- FOR UPDATE SKIP LOCKED, losers get no row.
--
-- Claim marker without schema change: the lease is the
-- next_run_at bump itself. Claimed rows carry next_run_at =
-- now() + lease, so a crashed worker's enrollment becomes due
-- again after the lease (self-healing); the executor never
-- gates on next_run_at, it just runs the claimed id.
-- Normal completion overwrites next_run_at anyway.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION claim_due_sequence_enrollments(
  p_limit integer,
  p_lease_seconds integer DEFAULT 300
)
RETURNS SETOF sequence_enrollments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT e.id
    FROM sequence_enrollments e
    WHERE e.status = 'active'
      AND e.next_run_at IS NOT NULL
      AND e.next_run_at <= NOW()
    ORDER BY e.next_run_at
    LIMIT GREATEST(p_limit, 0)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE sequence_enrollments se
  SET next_run_at = NOW() + (GREATEST(p_lease_seconds, 30) || ' seconds')::interval,
      updated_at = NOW()
  FROM picked
  WHERE se.id = picked.id
  RETURNING se.*;
END;
$$;

ALTER FUNCTION claim_due_sequence_enrollments(integer, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION claim_due_sequence_enrollments(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_due_sequence_enrollments(integer, integer) TO service_role;

COMMENT ON FUNCTION claim_due_sequence_enrollments(integer, integer) IS
  'T4.1: atomically claim due sequence enrollments via lease-bump; crashed workers self-heal after the lease.';
