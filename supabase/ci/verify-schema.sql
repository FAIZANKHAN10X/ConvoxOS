-- Post-migration assertions for the CI job in
-- `.github/workflows/migrations.yml`.
--
-- `supabase db reset` already fails on any statement Postgres rejects,
-- so this is not about syntax. It's about the quieter failure: a
-- migration that applies cleanly and does nothing. Every DDL statement
-- in this repo is guarded with IF NOT EXISTS / ON CONFLICT so the files
-- can be re-run safely, and that same guard turns a typo'd object name
-- into a silent no-op with a green checkmark.
--
-- Keep this thin. It is a smoke test for "did the migrations actually
-- build the schema", not a spec of it — asserting every column here
-- would just be the migrations restated in a second place, drifting.
DO $$
BEGIN
  -- The core tables, from 001.
  IF to_regclass('public.messages') IS NULL THEN
    RAISE EXCEPTION 'public.messages is missing — migrations did not apply';
  END IF;
  IF to_regclass('public.whatsapp_config') IS NULL THEN
    RAISE EXCEPTION 'public.whatsapp_config is missing — migrations did not apply';
  END IF;

  -- Supabase provides the storage schema; migrations 016/020/023 write
  -- to it. If it is absent the bucket migrations silently accomplish
  -- nothing, which is precisely the case a plain "no errors" run hides.
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION
      'storage.buckets is missing — the storage schema was not available when the bucket migrations ran';
  END IF;

  -- Buckets are UPSERTed, so their absence means the INSERT never ran.
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'chat-media') THEN
    RAISE EXCEPTION 'the chat-media bucket row was not created (migration 023)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'flow-media') THEN
    RAISE EXCEPTION 'the flow-media bucket row was not created (migration 016)';
  END IF;

  -- Account scoping (017) is load-bearing for every RLS policy.
  IF to_regclass('public.accounts') IS NULL THEN
    RAISE EXCEPTION 'public.accounts is missing — migration 017 did not apply';
  END IF;

  -- Automation engine (057). These names reuse the retired 006 labels
  -- with a new schema; absence means 057 did not apply.
  IF to_regclass('public.domain_events') IS NULL THEN
    RAISE EXCEPTION 'public.domain_events is missing — migration 057 did not apply';
  END IF;
  IF to_regclass('public.automations') IS NULL THEN
    RAISE EXCEPTION 'public.automations is missing — migration 057 did not apply';
  END IF;
  IF to_regclass('public.automation_versions') IS NULL THEN
    RAISE EXCEPTION 'public.automation_versions is missing — migration 057 did not apply';
  END IF;
  IF to_regclass('public.automation_runs') IS NULL THEN
    RAISE EXCEPTION 'public.automation_runs is missing — migration 057 did not apply';
  END IF;
  IF to_regclass('public.automation_run_steps') IS NULL THEN
    RAISE EXCEPTION 'public.automation_run_steps is missing — migration 057 did not apply';
  END IF;
  IF to_regclass('public.automation_waits') IS NULL THEN
    RAISE EXCEPTION 'public.automation_waits is missing — migration 057 did not apply';
  END IF;
  IF to_regprocedure('public.claim_domain_events(integer)') IS NULL THEN
    RAISE EXCEPTION 'claim_domain_events is missing — migration 057 did not apply';
  END IF;

  -- Integration layer (058).
  IF to_regclass('public.integration_endpoints') IS NULL THEN
    RAISE EXCEPTION 'public.integration_endpoints is missing — migration 058 did not apply';
  END IF;
  IF to_regclass('public.automation_inbound_hooks') IS NULL THEN
    RAISE EXCEPTION 'public.automation_inbound_hooks is missing — migration 058 did not apply';
  END IF;

  -- Inbound webhooks enqueue source = 'external' (059).
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.domain_events'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%external%'
  ) THEN
    RAISE EXCEPTION
      'domain_events.source does not allow external — migration 059 did not apply';
  END IF;

  RAISE NOTICE 'schema verification passed';
END
$$;

-- Two things this file has already been burned by, both verified in CI
-- rather than assumed:
--
-- 1. It must contain EXACTLY ONE statement. `supabase db query --file`
--    sends the whole file as a prepared statement, and a second
--    top-level statement fails with the distinctly unhelpful "cannot
--    insert multiple commands into a prepared statement" (commit
--    f91a6c8). Add assertions INSIDE the DO block above; do not append
--    a second one.
--
-- 2. A RAISE in here really does fail the job. A deliberately false
--    assertion (commit 42c7db0, run 31579334056) surfaced as
--    `failed to execute query: error: ...` and exited 1. This is not a
--    decorative green tick.
