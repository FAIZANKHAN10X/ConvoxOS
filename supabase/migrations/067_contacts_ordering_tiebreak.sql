-- ============================================================
-- 067_contacts_ordering_tiebreak.sql — T1.5 deterministic paging
--
-- The contacts list pages with OFFSET (.range / p_offset). Offset
-- pagination is the right fit for the numbered page UI, but it is
-- only stable when the ordering is total: created_at ties (common
-- for CSV imports — same timestamp for every row) made row
-- placement across pages nondeterministic.
--
-- Unify every contacts ordering to (created_at DESC, id DESC).
-- Concurrent inserts can still shift offset windows (inherent to
-- offset paging; acceptable for a 25-row admin list) — but ties
-- no longer shuffle rows between pages.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION public.filter_contacts_by_tags(
  p_tag_ids UUID[],
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (contact contacts, total_count BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH matched AS (
    SELECT DISTINCT c.id, c.created_at
    FROM contacts c
    JOIN contact_tags ct ON ct.contact_id = c.id
    WHERE ct.tag_id = ANY(p_tag_ids)
      AND (
        p_search IS NULL
        OR c.name ILIKE '%' || p_search || '%'
        OR c.phone ILIKE '%' || p_search || '%'
        OR c.email ILIKE '%' || p_search || '%'
      )
  ),
  page AS (
    SELECT id, count(*) OVER() AS total_count
    FROM matched
    ORDER BY created_at DESC, id DESC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT c AS contact, page.total_count
  FROM page
  JOIN contacts c ON c.id = page.id
  ORDER BY c.created_at DESC, c.id DESC;
$$;
