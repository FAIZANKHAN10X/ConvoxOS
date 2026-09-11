-- ============================================================
-- 059_domain_event_external_source.sql
--
-- Migration 057 constrained domain_events.source to
-- ('crm', 'automation'). The integration layer (058) enqueues
-- inbound webhook deliveries as source = 'external' from
-- POST /api/hooks/[token]. Without this, every valid signed
-- delivery fails the CHECK and never reaches the worker.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE domain_events DROP CONSTRAINT IF EXISTS domain_events_source_check;
ALTER TABLE domain_events
  ADD CONSTRAINT domain_events_source_check
  CHECK (source IN ('crm', 'automation', 'external'));
