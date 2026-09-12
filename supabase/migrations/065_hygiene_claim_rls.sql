-- ============================================================
-- 065_hygiene_claim_rls.sql — T1.7 database hygiene
--
-- a) Claim/order alignment: claim_domain_events filters
--    status='pending' AND available_at<=NOW() but ORDERs BY
--    created_at. idx_domain_events_outbox keys available_at, so the
--    sort is not index-assisted. This partial index keys the ORDER
--    BY column under the same predicate, so backlog claims scan in
--    order and stop at the limit.
--
-- b) RLS auth.uid() efficiency: bare auth.uid() is evaluated per
--    row; wrapping as (select auth.uid()) lets the planner treat it
--    as an init-plan evaluated once. Semantics unchanged —
--    identical predicates, only the evaluation shape changes.
--
-- d) forbid_automation_version_update hardening: add the
--    SET search_path = public clause every sibling function has,
--    closing search_path hijacking for the trigger.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- a) Index matching the claim's ORDER BY under its filter predicate.
CREATE INDEX IF NOT EXISTS idx_domain_events_claim_order
  ON domain_events (created_at)
  WHERE status = 'pending';

-- d) Harden search_path (body identical to 057, clause added).
CREATE OR REPLACE FUNCTION forbid_automation_version_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'automation_versions are immutable';
END;
$$;

-- b) is_account_member: evaluate auth.uid() once per statement.
CREATE OR REPLACE FUNCTION is_account_member(
  target_account_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.user_id = (select auth.uid())
      AND p.account_id = target_account_id
      AND CASE p.account_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
        >=
          CASE min_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
  );
$$;

-- b) profiles policies: same predicates, init-plan auth.uid().
DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles FOR SELECT
  USING ((select auth.uid()) = user_id OR is_account_member(account_id));
DROP POLICY IF EXISTS profiles_update ON profiles;
CREATE POLICY profiles_update ON profiles FOR UPDATE
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS profiles_insert ON profiles;
CREATE POLICY profiles_insert ON profiles FOR INSERT
  WITH CHECK ((select auth.uid()) = user_id);
