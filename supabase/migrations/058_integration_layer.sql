-- ============================================================
-- 058_integration_layer.sql — External integration boundary
--
-- ConvoxOS stays the native CRM + automation engine. This migration
-- adds ONLY the two tables the integration layer needs:
--
--   1. `integration_endpoints` — named references to external
--      systems (n8n webhook URLs, generic APIs). Secrets encrypted
--      at rest, shown once. Consumed by `action.n8n_workflow`.
--   2. `automation_inbound_hooks` — one bearer-token + HMAC-secret
--      pair per automation using `trigger.inbound_webhook`. External
--      systems POST here; valid requests become domain events.
--
-- Conventions mirror 028_webhook_endpoints.sql exactly:
--   - Account-scoped, never user-scoped (`created_by` is audit-only).
--   - Secrets AES-256-GCM-encrypted at rest, plaintext shown once.
--   - Settings-class RLS: members read, admin+ writes. The runtime
--     paths use the service-role client (no `auth.uid()` there).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS integration_endpoints (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name             text NOT NULL,
  kind             text NOT NULL DEFAULT 'n8n', -- 'n8n' | 'generic'
  url              text NOT NULL,             -- HTTPS endpoint we POST to
  secret_enc       text NOT NULL,             -- AES-256-GCM-encrypted HMAC signing secret
  is_active        boolean NOT NULL DEFAULT true,
  last_delivery_at timestamptz,               -- last successful delivery
  failure_count    integer NOT NULL DEFAULT 0, -- consecutive failures; reset to 0 on success
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS integration_endpoints_account_id_idx
  ON integration_endpoints (account_id);

ALTER TABLE integration_endpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integration_endpoints_select ON integration_endpoints;
CREATE POLICY integration_endpoints_select ON integration_endpoints FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS integration_endpoints_insert ON integration_endpoints;
CREATE POLICY integration_endpoints_insert ON integration_endpoints FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS integration_endpoints_update ON integration_endpoints;
CREATE POLICY integration_endpoints_update ON integration_endpoints FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS integration_endpoints_delete ON integration_endpoints;
CREATE POLICY integration_endpoints_delete ON integration_endpoints FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- automation_inbound_hooks — one bearer-token pair per automation.
--
-- `token_hash` is the SHA-256 hex of the bearer token in the hook
-- URL (`/api/hooks/<token>`), mirroring `api_keys.key_hash`: a
-- leaked snapshot can't be replayed. `secret_enc` is the HMAC key
-- the sender signs each delivery with (same `X-Wacrm-Signature`
-- scheme as outbound webhooks); we need it at verify time, so it
-- is stored encrypted, not hashed. Both values are returned exactly
-- once at creation.
-- ============================================================

CREATE TABLE IF NOT EXISTS automation_inbound_hooks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  automation_id    uuid NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  token_hash       text NOT NULL UNIQUE,
  secret_enc       text NOT NULL,
  is_active        boolean NOT NULL DEFAULT true,
  last_received_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (automation_id)
);

CREATE INDEX IF NOT EXISTS automation_inbound_hooks_account_id_idx
  ON automation_inbound_hooks (account_id);

ALTER TABLE automation_inbound_hooks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS automation_inbound_hooks_select ON automation_inbound_hooks;
CREATE POLICY automation_inbound_hooks_select ON automation_inbound_hooks FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS automation_inbound_hooks_insert ON automation_inbound_hooks;
CREATE POLICY automation_inbound_hooks_insert ON automation_inbound_hooks FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS automation_inbound_hooks_update ON automation_inbound_hooks;
CREATE POLICY automation_inbound_hooks_update ON automation_inbound_hooks FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS automation_inbound_hooks_delete ON automation_inbound_hooks;
CREATE POLICY automation_inbound_hooks_delete ON automation_inbound_hooks FOR DELETE
  USING (is_account_member(account_id, 'admin'));
