-- ============================================================
-- 076_task_overdue_fired.sql — T5.3 task overdue trigger
--
-- tasks.overdue_fired_at: when the overdue sweep emitted
-- task_overdue for this task. The sweep only fires once per task
-- (NULL → timestamp), so the trigger is idempotent across ticks.
-- Reopening a task does not clear it; completing one stops the
-- sweep via the status filter. Nullable, no backfill.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS overdue_fired_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tasks_overdue_sweep
  ON tasks(due_at) WHERE status = 'open' AND overdue_fired_at IS NULL;

COMMENT ON COLUMN tasks.overdue_fired_at IS
  'T5.3: when task_overdue was emitted; one-shot per task.';
