-- ============================================================
-- 042_channel_not_null_enforce
--
-- Phase 1 hardening: enforce NOT NULL on messages.channel after
-- nullable backfill (041) and real Telegram verification.
-- Precondition: zero NULL rows (real Telegram smoke test passed).
-- Does NOT change DEFAULT, CHECK, indexes, or any other table.
--
-- Idempotent — safe to re-run. Fails fast if precondition violated.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.messages WHERE channel IS NULL) THEN
    RAISE EXCEPTION 'precondition failed: messages.channel has NULL rows (found %)', (SELECT COUNT(*) FROM public.messages WHERE channel IS NULL);
  END IF;
END $$;

ALTER TABLE public.messages ALTER COLUMN channel SET NOT NULL;
