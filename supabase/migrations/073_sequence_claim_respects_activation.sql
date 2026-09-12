-- ============================================================
-- 073_sequence_claim_respects_activation.sql — T4.3 activation
--
-- The sequence is_active toggle (management UI) must actually gate
-- execution: deactivating a sequence parks all of its enrollments
-- without cancelling them (positions preserved; reactivation
-- resumes via the normal due check). Implemented as a join in the
-- claim query — no new columns, no executor changes. Cannot edit
-- 070 (already applied), so the function is replaced here.
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
    JOIN sequences s ON s.id = e.sequence_id
    WHERE e.status = 'active'
      AND s.is_active IS TRUE
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

COMMENT ON FUNCTION claim_due_sequence_enrollments(integer, integer) IS
  'T4.3: claim requires the parent sequence is_active; deactivation parks enrollments without cancelling.';
