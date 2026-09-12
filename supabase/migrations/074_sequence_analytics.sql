-- ============================================================
-- 074_sequence_analytics.sql — T4.4 analytics v1
--
-- Single RPC returning one aggregate row per sequence:
-- enrolled, active, paused, completed, stopped, failed, sent,
-- replied. Follows the 068 dashboard pattern (one RPC per
-- widget, SECURITY INVOKER + explicit account predicates).
--
-- Semantics (documented, T4.4 spec):
--   enrolled  = all enrollments for the sequence
--   active/paused/completed = by status
--   stopped   = cancelled with reason reply/manual/NULL-legacy
--               (ended before completion, non-failure)
--   failed    = cancelled with reason failed
--   replied   = cancelled with reason reply (subset of stopped;
--               a reply always stops, T4.2)
--   sent      = messages persisted with seq:{enrollment}:{pos}
--               idempotency keys for this sequence's enrollments
--
-- A sequence outside the caller's account yields a zero row
-- (joins on sequences.account_id), never another account's data.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION get_sequence_analytics(
  p_account_id uuid,
  p_sequence_id uuid
)
RETURNS TABLE (
  enrolled bigint,
  active bigint,
  paused bigint,
  completed bigint,
  stopped bigint,
  failed bigint,
  sent bigint,
  replied bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH mine AS (
    SELECT e.id, e.status, e.cancelled_reason
    FROM sequence_enrollments e
    JOIN sequences s ON s.id = e.sequence_id
    WHERE e.sequence_id = p_sequence_id
      AND e.account_id = p_account_id
      AND s.account_id = p_account_id
  )
  SELECT
    (SELECT count(*) FROM mine) AS enrolled,
    (SELECT count(*) FROM mine WHERE status = 'active') AS active,
    (SELECT count(*) FROM mine WHERE status = 'paused') AS paused,
    (SELECT count(*) FROM mine WHERE status = 'completed') AS completed,
    (SELECT count(*) FROM mine
      WHERE status = 'cancelled'
        AND (cancelled_reason IS NULL OR cancelled_reason IN ('reply', 'manual'))) AS stopped,
    (SELECT count(*) FROM mine WHERE status = 'cancelled' AND cancelled_reason = 'failed') AS failed,
    (SELECT count(*)
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.account_id = p_account_id
        AND m.idempotency_key LIKE 'seq:%'
        AND EXISTS (SELECT 1 FROM mine WHERE mine.id::text = split_part(m.idempotency_key, ':', 2))
    ) AS sent,
    (SELECT count(*) FROM mine WHERE status = 'cancelled' AND cancelled_reason = 'reply') AS replied;
$$;

COMMENT ON FUNCTION get_sequence_analytics(uuid, uuid) IS
  'T4.4: one-row sequence analytics (enrolled/active/paused/completed/stopped/failed/sent/replied).';
