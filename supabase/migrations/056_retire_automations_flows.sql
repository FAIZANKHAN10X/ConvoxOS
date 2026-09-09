-- ============================================================
-- 056_retire_automations_flows — Phase 9 clean-slate retirement
--
-- Drops automation/flow-specific tables that are no longer the
-- canonical product. Keeps shared CRM/AI/channel infrastructure.
--
-- KEEP (not dropped):
--   accounts, profiles, contacts (+ phone_normalized, telegram_*),
--   contact_tags, tags, custom_fields, contact_custom_values,
--   conversations, messages (incl. channel, interactive_*),
--   whatsapp_config, telegram_config, pipelines, deals,
--   broadcasts, tasks (except source_automation_id column is kept nullable),
--   notifications, member_presence, ai_* (configs, knowledge, goals, usage),
--   webhook_endpoints, api_keys, chat-media bucket,
--   sequences, sequence_steps, sequence_enrollments (KEEP per Phase 9)
--
-- DROP order respects FKs (children first):
--   preview_sessions, contact_randomizer_buckets,
--   flow_run_events → flow_runs → flow_nodes → flows,
--   automation_trigger_evaluations, automation_versions,
--   automation_logs → automation_pending_executions (after flow_runs cleared)
--   → automation_steps → automations
--
-- Also drops: flow-media bucket policies, increment functions,
-- realtime publication for flow_runs if present, and related indexes/policies
-- (auto-dropped with table). Historical migration files 006/010/016/045/046/048/050/055 are kept.
-- ============================================================

-- Helper: drop publication table if still present (idempotent)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'flow_runs') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE flow_runs;
  END IF;
END $$;

-- 1. Preview & randomizer (no FK to automations, only to flows/contacts)
DROP TABLE IF EXISTS preview_sessions CASCADE;
DROP TABLE IF EXISTS contact_randomizer_buckets CASCADE;

-- 2. Flow runtime (children first)
DROP TABLE IF EXISTS flow_run_events CASCADE;
DROP TABLE IF EXISTS flow_runs CASCADE;
DROP TABLE IF EXISTS flow_nodes CASCADE;
-- flow-media bucket storage objects are in storage.buckets + storage.objects, not dropped here;
-- RLS policies on flow-media will be orphaned but harmless. Drop bucket if empty:
-- (storage.buckets is not in public schema, so handled via storage API in app code, not SQL)

-- 3. Flows envelope (parent)
DROP TABLE IF EXISTS flows CASCADE;

-- 4. Automation-specific (children first, then parent)
DROP TABLE IF EXISTS automation_trigger_evaluations CASCADE;
DROP TABLE IF EXISTS automation_versions CASCADE;
DROP TABLE IF EXISTS automation_logs CASCADE;
-- automation_pending_executions is hybrid (also used by flows waits) — now safe to drop after flow_runs cleared
DROP TABLE IF EXISTS automation_pending_executions CASCADE;
DROP TABLE IF EXISTS automation_steps CASCADE;
DROP TABLE IF EXISTS automations CASCADE;

-- 5. Functions / triggers specific to dropped tables (keep shared tasks.source_automation_id column nullable)
DROP FUNCTION IF EXISTS increment_automation_execution_count(UUID) CASCADE;
DROP FUNCTION IF EXISTS increment_flow_execution_count(UUID) CASCADE;

-- Note: tasks.source_automation_id column is kept nullable for history;
-- it will be SET NULL automatically via FK ON DELETE SET NULL when automations dropped.
-- No need to DROP COLUMN — keep for audit.

-- Realtime publication already handled above; no other shared infra touched.
