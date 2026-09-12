-- ============================================================
-- 075_task_deal_link_and_deal_reason.sql — T4.5 task/deal completion
--
-- tasks.deal_id: optional link from a task to a deal, so the Tasks
-- UI can show act-on context and deals can surface follow-ups.
-- Nullable, no backfill; delete behavior mirrors contact_id
-- (SET NULL — losing a deal must not lose the task record).
--
-- deals.lost_reason: free-text reason captured when a deal is
-- marked lost (won needs no reason). Nullable, no backfill.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS deal_id UUID REFERENCES deals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_deal
  ON tasks(deal_id) WHERE deal_id IS NOT NULL;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS lost_reason TEXT;

COMMENT ON COLUMN tasks.deal_id IS
  'T4.5: optional deal a task acts on; SET NULL on deal delete.';
COMMENT ON COLUMN deals.lost_reason IS
  'T4.5: reason captured when a deal is marked lost; NULL otherwise.';
