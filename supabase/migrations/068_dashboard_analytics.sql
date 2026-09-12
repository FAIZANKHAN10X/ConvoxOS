-- ============================================================
-- 068_dashboard_analytics.sql — T1.3 dashboard consolidation
--
-- The dashboard recomputed everything per visit in JS: 8 count
-- queries + a full open-deals scan for metrics, a second full
-- open-deals scan for the donut, unbounded 30d + 14d message
-- pulls with JS bucketing/pairing (~16 trips, raw rows over the
-- wire). Four RPCs — one per widget group — move aggregation
-- into PostgreSQL. Deliberately NOT one mega-query: each widget
-- stays independently readable and testable.
--
-- Timezone honesty: "today" boundaries and day buckets are caller
-- tz-dependent. Callers pass precomputed timestamptz bounds (same
-- values the JS used) and an IANA tz name for day bucketing, so
-- definitions are unchanged — only the execution location moves.
--
-- SECURITY INVOKER throughout: RLS applies per row on top of the
-- explicit account predicates.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- 1) Metric cards: 9 scalars, zero data rows over the wire.
-- Replaces loadMetrics' 7 head-counts + full open-deals pull.
CREATE OR REPLACE FUNCTION dashboard_metrics(
  p_account_id uuid,
  p_today_start timestamptz,
  p_yesterday_start timestamptz
)
RETURNS TABLE (
  open_conv bigint,
  new_conv_today bigint,
  new_conv_yesterday bigint,
  new_contacts_today bigint,
  new_contacts_yesterday bigint,
  open_deals_count bigint,
  open_deals_value numeric,
  msgs_today bigint,
  msgs_yesterday bigint
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    (SELECT count(*) FROM conversations
      WHERE account_id = p_account_id AND status = 'open'),
    (SELECT count(*) FROM conversations
      WHERE account_id = p_account_id AND status = 'open'
        AND created_at >= p_today_start),
    (SELECT count(*) FROM conversations
      WHERE account_id = p_account_id AND status = 'open'
        AND created_at >= p_yesterday_start AND created_at < p_today_start),
    (SELECT count(*) FROM contacts
      WHERE account_id = p_account_id AND created_at >= p_today_start),
    (SELECT count(*) FROM contacts
      WHERE account_id = p_account_id
        AND created_at >= p_yesterday_start AND created_at < p_today_start),
    (SELECT count(*) FROM deals
      WHERE account_id = p_account_id AND status = 'open'),
    (SELECT COALESCE(SUM(value), 0) FROM deals
      WHERE account_id = p_account_id AND status = 'open'),
    (SELECT count(*) FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.account_id = p_account_id AND m.sender_type = 'agent'
        AND m.created_at >= p_today_start),
    (SELECT count(*) FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.account_id = p_account_id AND m.sender_type = 'agent'
        AND m.created_at >= p_yesterday_start AND m.created_at < p_today_start);
$$;

-- 2) Per-day incoming/outgoing counts, bucketed in the caller's
-- timezone. Rows bounded by 2x days. Replaces the 30d raw pull.
CREATE OR REPLACE FUNCTION dashboard_series(
  p_account_id uuid,
  p_start timestamptz,
  p_tz text
)
RETURNS TABLE (day date, incoming bigint, outgoing bigint)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    (timezone(p_tz, m.created_at))::date AS day,
    count(*) FILTER (WHERE m.sender_type = 'customer') AS incoming,
    count(*) FILTER (WHERE m.sender_type <> 'customer') AS outgoing
  FROM messages m
  JOIN conversations c ON c.id = m.conversation_id
  WHERE c.account_id = p_account_id
    AND m.created_at >= p_start
  GROUP BY 1
  ORDER BY 1;
$$;

-- 3) Pipeline donut: stages left-joined to open-deal aggregates.
-- One trip; replaces stages list + second open-deals scan.
CREATE OR REPLACE FUNCTION dashboard_pipeline(p_account_id uuid)
RETURNS TABLE (
  stage_id uuid,
  stage_name text,
  stage_color text,
  deal_count bigint,
  total_value numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    s.id AS stage_id,
    s.name AS stage_name,
    s.color AS stage_color,
    count(d.id) AS deal_count,
    COALESCE(SUM(d.value), 0) AS total_value
  FROM pipeline_stages s
  LEFT JOIN deals d ON d.stage_id = s.id
    AND d.status = 'open'
    AND d.account_id = p_account_id
  WHERE s.pipeline_id IN (
    SELECT p.id FROM pipelines p WHERE p.account_id = p_account_id
  )
  GROUP BY s.id, s.name, s.color, s.position
  ORDER BY s.position;
$$;

-- 4) Response-time samples: first-customer-since-outbound paired
-- with the next outbound, per conversation. Returns sparse samples
-- (not raw messages); JS keeps its exact bucketing/averaging.
-- Mirrors the JS walk: a customer message counts when no customer
-- message is pending since the last outbound (or start).
CREATE OR REPLACE FUNCTION dashboard_response_samples(
  p_account_id uuid,
  p_start timestamptz
)
RETURNS TABLE (customer_at timestamptz, minutes numeric)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH ordered AS (
    SELECT
      m.conversation_id,
      m.sender_type,
      m.created_at,
      LAG(m.sender_type) OVER (
        PARTITION BY m.conversation_id ORDER BY m.created_at, m.id
      ) AS prev_sender
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.account_id = p_account_id
      AND m.created_at >= p_start
  ),
  firsts AS (
    SELECT conversation_id, created_at AS customer_at
    FROM ordered
    WHERE sender_type = 'customer'
      AND prev_sender IS DISTINCT FROM 'customer'
  )
  SELECT
    f.customer_at,
    EXTRACT(EPOCH FROM (resp.response_at - f.customer_at)) / 60 AS minutes
  FROM firsts f
  CROSS JOIN LATERAL (
    SELECT MIN(m2.created_at) AS response_at
    FROM messages m2
    WHERE m2.conversation_id = f.conversation_id
      AND m2.sender_type <> 'customer'
      AND m2.created_at > f.customer_at
  ) resp
  WHERE resp.response_at IS NOT NULL;
$$;

COMMENT ON FUNCTION dashboard_metrics(uuid, timestamptz, timestamptz) IS
  'T1.3: dashboard metric cards as 9 scalars in one trip.';
COMMENT ON FUNCTION dashboard_series(uuid, timestamptz, text) IS
  'T1.3: per-day incoming/outgoing counts, caller-tz buckets.';
COMMENT ON FUNCTION dashboard_pipeline(uuid) IS
  'T1.3: pipeline stages with open-deal aggregates in one trip.';
COMMENT ON FUNCTION dashboard_response_samples(uuid, timestamptz) IS
  'T1.3: first-response pairing samples; JS keeps bucketing/averaging.';
