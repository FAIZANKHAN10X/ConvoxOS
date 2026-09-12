import { supabaseAdmin } from '@/lib/supabase/admin';

import { emitTaskOverdue } from '@/lib/automation/crm-events';

const SWEEP_LIMIT = 100;

/**
 * T5.3: emit `task_overdue` for open tasks whose due date passed
 * and which never fired. One-shot per task (`overdue_fired_at`),
 * bounded to SWEEP_LIMIT rows per tick, rides the existing
 * automation-worker tick — no new scheduler. Best-effort: one
 * bad row never aborts the sweep.
 */
export async function sweepOverdueTasks(now: Date = new Date()): Promise<number> {
  const db = supabaseAdmin();
  const { data: due, error } = await db
    .from('tasks')
    .select('id, account_id, contact_id, title, due_at')
    .eq('status', 'open')
    .is('overdue_fired_at', null)
    .not('due_at', 'is', null)
    .lt('due_at', now.toISOString())
    .not('contact_id', 'is', null)
    .limit(SWEEP_LIMIT);
  if (error || !due) {
    console.error('[tasks-overdue] sweep read failed:', error?.message);
    return 0;
  }

  let fired = 0;
  for (const row of due as Array<Record<string, unknown>>) {
    try {
      const taskId = row.id as string;
      const accountId = row.account_id as string;
      const contactId = row.contact_id as string;
      await emitTaskOverdue({
        db,
        accountId,
        contactId,
        payload: {
          task_id: taskId,
          title: row.title,
          due_at: row.due_at,
        },
        idempotencyKey: `task_overdue:${taskId}`,
        source: 'crm',
      });
      await db
        .from('tasks')
        .update({ overdue_fired_at: now.toISOString() })
        .eq('id', taskId);
      fired += 1;
    } catch (e) {
      console.error('[tasks-overdue] row failed:', (e as Error)?.message);
    }
  }
  return fired;
}
