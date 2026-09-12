-- ============================================================
-- 066_contact_activity_feed.sql — T1.2 single-RPC activity feed
--
-- getContactActivityFeed ran 7 round trips (up to 6x limit rows)
-- and merged/sorted/paginated in JS with a timestamp-only cursor
-- that loses millisecond ties and shifts under concurrent writes.
--
-- This RPC returns one ordered page across all activity sources:
-- UNION ALL of per-branch top-(limit+1) rows, global ORDER BY
-- (created_at DESC, key DESC), LIMIT limit+1. Correct because the
-- global top-(limit+1) is always contained in the union of
-- per-branch top-(limit+1) sets.
--
-- Cursor is an opaque caller-provided (created_at, key) pair —
-- tie-safe via the unique key, stable under concurrent inserts
-- (strictly-older rows plus same-timestamp smaller keys).
--
-- Account scoping is explicit in every branch (own account_id
-- column or a contacts join for contact_tags/contact_notes,
-- which carry no account_id). SECURITY INVOKER so RLS still
-- applies per row on top of the explicit predicates.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION get_contact_activity(
  p_account_id uuid,
  p_contact_id uuid,
  p_limit integer,
  p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_key text DEFAULT NULL,
  p_filter text DEFAULT 'all'
)
RETURNS TABLE (
  item_id text,
  item_type text,
  created_at timestamptz,
  title text,
  description text,
  metadata jsonb,
  key text
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH params AS (
    SELECT
      GREATEST(1, LEAST(COALESCE(p_limit, 50), 100)) AS lim,
      p_cursor_created_at AS cur_ts,
      p_cursor_key AS cur_key,
      NULLIF(p_filter, 'all') AS type_filter
  ),
  msgs AS (
    SELECT
      ('msg-' || m.id::text) AS item_id,
      (CASE WHEN m.sender_type IN ('agent', 'bot')
        THEN 'message_outbound' ELSE 'message_inbound' END) AS item_type,
      m.created_at AS created_at,
      (CASE WHEN m.sender_type IN ('agent', 'bot')
        THEN 'Message sent' ELSE 'Message received' END) AS title,
      COALESCE(NULLIF(LEFT(m.content_text, 120), ''), '[' || m.content_type || ']') AS description,
      jsonb_build_object(
        'channel', m.channel, 'status', m.status,
        'content_type', m.content_type
      ) AS metadata,
      m.id::text AS key
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.account_id = p_account_id
      AND c.contact_id = p_contact_id
      AND (
        (SELECT cur_ts FROM params) IS NULL
        OR m.created_at < (SELECT cur_ts FROM params)
        OR (m.created_at = (SELECT cur_ts FROM params)
          AND m.id::text < (SELECT cur_key FROM params))
      )
    ORDER BY m.created_at DESC, m.id::text DESC
    LIMIT (SELECT lim + 1 FROM params)
  ),
  tags AS (
    SELECT
      ('tag-' || ct.tag_id::text || '-' || ct.created_at::text) AS item_id,
      'tag_added'::text AS item_type,
      ct.created_at AS created_at,
      'Tag added'::text AS title,
      COALESCE(t.name, ct.tag_id::text) AS description,
      '{}'::jsonb AS metadata,
      ct.tag_id::text AS key
    FROM contact_tags ct
    JOIN contacts co ON co.id = ct.contact_id
    LEFT JOIN tags t ON t.id = ct.tag_id
    WHERE co.account_id = p_account_id
      AND ct.contact_id = p_contact_id
      AND (
        (SELECT cur_ts FROM params) IS NULL
        OR ct.created_at < (SELECT cur_ts FROM params)
        OR (ct.created_at = (SELECT cur_ts FROM params)
          AND ct.tag_id::text < (SELECT cur_key FROM params))
      )
    ORDER BY ct.created_at DESC, ct.tag_id::text DESC
    LIMIT (SELECT lim + 1 FROM params)
  ),
  tasks AS (
    SELECT
      ('task-' || t.id::text) AS item_id,
      'task_created'::text AS item_type,
      t.created_at AS created_at,
      'Task created'::text AS title,
      t.title AS description,
      jsonb_build_object('status', t.status, 'due_at', t.due_at) AS metadata,
      t.id::text AS key
    FROM tasks t
    WHERE t.account_id = p_account_id
      AND t.contact_id = p_contact_id
      AND (
        (SELECT cur_ts FROM params) IS NULL
        OR t.created_at < (SELECT cur_ts FROM params)
        OR (t.created_at = (SELECT cur_ts FROM params)
          AND t.id::text < (SELECT cur_key FROM params))
      )
    ORDER BY t.created_at DESC, t.id::text DESC
    LIMIT (SELECT lim + 1 FROM params)
  ),
  deals AS (
    SELECT
      ('deal-' || d.id::text) AS item_id,
      'deal_created'::text AS item_type,
      d.created_at AS created_at,
      'Opportunity created'::text AS title,
      (d.title || ' — ' || COALESCE(s.name, d.stage_id::text)) AS description,
      jsonb_build_object('stage_id', d.stage_id, 'status', d.status) AS metadata,
      d.id::text AS key
    FROM deals d
    LEFT JOIN pipeline_stages s ON s.id = d.stage_id
    WHERE d.account_id = p_account_id
      AND d.contact_id = p_contact_id
      AND (
        (SELECT cur_ts FROM params) IS NULL
        OR d.created_at < (SELECT cur_ts FROM params)
        OR (d.created_at = (SELECT cur_ts FROM params)
          AND d.id::text < (SELECT cur_key FROM params))
      )
    ORDER BY d.created_at DESC, d.id::text DESC
    LIMIT (SELECT lim + 1 FROM params)
  ),
  notes AS (
    SELECT
      ('note-' || n.id::text) AS item_id,
      'note_added'::text AS item_type,
      n.created_at AS created_at,
      'Note added'::text AS title,
      LEFT(n.note_text, 120) AS description,
      '{}'::jsonb AS metadata,
      n.id::text AS key
    FROM contact_notes n
    JOIN contacts co ON co.id = n.contact_id
    WHERE co.account_id = p_account_id
      AND n.contact_id = p_contact_id
      AND (
        (SELECT cur_ts FROM params) IS NULL
        OR n.created_at < (SELECT cur_ts FROM params)
        OR (n.created_at = (SELECT cur_ts FROM params)
          AND n.id::text < (SELECT cur_key FROM params))
      )
    ORDER BY n.created_at DESC, n.id::text DESC
    LIMIT (SELECT lim + 1 FROM params)
  ),
  enrolls AS (
    SELECT
      ('seq-' || e.id::text) AS item_id,
      (CASE WHEN e.status = 'completed' THEN 'sequence_completed'
        WHEN e.status = 'cancelled' THEN 'sequence_cancelled'
        ELSE 'sequence_enrolled' END) AS item_type,
      COALESCE(e.completed_at, e.cancelled_at, e.created_at) AS created_at,
      (CASE WHEN e.status = 'completed' THEN 'Sequence completed'
        WHEN e.status = 'cancelled' THEN 'Sequence cancelled'
        ELSE 'Sequence enrolled' END) AS title,
      COALESCE(sq.name, e.sequence_id::text) AS description,
      jsonb_build_object('status', e.status) AS metadata,
      e.id::text AS key
    FROM sequence_enrollments e
    LEFT JOIN sequences sq ON sq.id = e.sequence_id
    WHERE e.account_id = p_account_id
      AND e.contact_id = p_contact_id
      AND (
        (SELECT cur_ts FROM params) IS NULL
        OR COALESCE(e.completed_at, e.cancelled_at, e.created_at) < (SELECT cur_ts FROM params)
        OR (COALESCE(e.completed_at, e.cancelled_at, e.created_at) = (SELECT cur_ts FROM params)
          AND e.id::text < (SELECT cur_key FROM params))
      )
    ORDER BY COALESCE(e.completed_at, e.cancelled_at, e.created_at) DESC, e.id::text DESC
    LIMIT (SELECT lim + 1 FROM params)
  ),
  all_items AS (
    SELECT * FROM msgs
    UNION ALL SELECT * FROM tags
    UNION ALL SELECT * FROM tasks
    UNION ALL SELECT * FROM deals
    UNION ALL SELECT * FROM notes
    UNION ALL SELECT * FROM enrolls
  ),
  filtered AS (
    SELECT item_id, item_type, created_at, title, description, metadata, key
    FROM all_items
    WHERE (SELECT type_filter FROM params) IS NULL
      OR item_type = (SELECT type_filter FROM params)
    ORDER BY created_at DESC, key DESC
    LIMIT (SELECT lim + 1 FROM params)
  )
  SELECT item_id, item_type, created_at, title, description, metadata, key
  FROM filtered;
$$;

COMMENT ON FUNCTION get_contact_activity(uuid, uuid, integer, timestamptz, text, text) IS
  'Single-RPC contact activity feed: UNION ALL across sources with keyset (created_at, key) pagination. Replaces the 7-trip JS-merged feed.';
