-- ============================================================
-- 064_conversation_channel_summaries.sql — Bound inbox channel load
--
-- The inbox derived per-conversation channels by downloading the
-- entire messages table (conversation_id, channel, created_at) and
-- grouping in JS. That is O(total messages) per list load and
-- silently wrong past PostgREST's implicit row cap (oldest-first
-- order means conversations beyond the cap lose channel badges).
--
-- This RPC returns one row per conversation that has messages:
-- the distinct channel set plus the latest channel by created_at.
-- Rows bounded by conversation count, correct at any message
-- volume. Uses idx_messages_conversation_channel (041).
--
-- SECURITY INVOKER (default): RLS on messages/conversations
-- applies per row, so the browser client sees only its own
-- account's rows. p_account_id is a filter, not a trust
-- boundary — RLS remains the enforcement.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION conversation_channel_summaries(p_account_id uuid)
RETURNS TABLE (
  conversation_id uuid,
  channels text[],
  latest_channel text
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    m.conversation_id,
    array_agg(DISTINCT m.channel) FILTER (WHERE m.channel IS NOT NULL),
    (
      SELECT m2.channel
      FROM messages m2
      WHERE m2.conversation_id = m.conversation_id
        AND m2.channel IS NOT NULL
      ORDER BY m2.created_at DESC
      LIMIT 1
    )
  FROM messages m
  JOIN conversations c ON c.id = m.conversation_id
  WHERE c.account_id = p_account_id
  GROUP BY m.conversation_id;
$$;

COMMENT ON FUNCTION conversation_channel_summaries(uuid) IS
  'One row per conversation with messages: distinct channel set + latest channel. Replaces the inbox full-table messages scan.';
