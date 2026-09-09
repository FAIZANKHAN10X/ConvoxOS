import type { SupabaseClient } from '@supabase/supabase-js';

import {
  emitTaskCompleted,
  emitTaskCreated,
} from '@/lib/automation/crm-events';

export class TaskWriteError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'TaskWriteError';
    this.status = status;
  }
}

export interface CreateTaskInput {
  accountId: string;
  userId: string;
  contactId?: string | null;
  assignedTo?: string | null;
  title: string;
  description?: string | null;
  dueAt?: string | null;
  sourceAutomationId?: string | null;
}

export interface TaskRow {
  id: string;
  account_id: string;
  contact_id: string | null;
  title: string;
  status: string;
}

export async function createTask(
  db: SupabaseClient,
  input: CreateTaskInput
): Promise<TaskRow> {
  const title = input.title.trim();
  if (!title) throw new TaskWriteError('Task title is required', 400);

  const { data, error } = await db
    .from('tasks')
    .insert({
      account_id: input.accountId,
      user_id: input.userId,
      contact_id: input.contactId ?? null,
      assigned_to: input.assignedTo ?? null,
      title,
      description: input.description ?? null,
      status: 'open',
      due_at: input.dueAt ?? null,
      source_automation_id: input.sourceAutomationId ?? null,
    })
    .select('id, account_id, contact_id, title, status')
    .single();

  if (error || !data) {
    throw new TaskWriteError(
      `Failed to create task: ${error?.message ?? 'no row'}`
    );
  }

  const row = data as TaskRow;
  if (row.contact_id) {
    await emitTaskCreated({
      db,
      accountId: input.accountId,
      contactId: row.contact_id,
      payload: { task_id: row.id, title: row.title },
      idempotencyKey: `task_created:${row.id}`,
    });
  }

  return row;
}

export async function completeTask(
  db: SupabaseClient,
  input: { accountId: string; taskId: string }
): Promise<{ completed: boolean; task: TaskRow | null }> {
  const { data: existing, error: readError } = await db
    .from('tasks')
    .select('id, account_id, contact_id, title, status')
    .eq('id', input.taskId)
    .eq('account_id', input.accountId)
    .maybeSingle();

  if (readError) {
    throw new TaskWriteError(`Failed to load task: ${readError.message}`);
  }
  if (!existing) throw new TaskWriteError('Task not found', 404);

  const row = existing as TaskRow;
  if (row.status === 'completed') {
    return { completed: false, task: row };
  }

  const { data: updated, error } = await db
    .from('tasks')
    .update({ status: 'completed' })
    .eq('id', input.taskId)
    .eq('account_id', input.accountId)
    .select('id, account_id, contact_id, title, status')
    .single();

  if (error || !updated) {
    throw new TaskWriteError(
      `Failed to complete task: ${error?.message ?? 'no row'}`
    );
  }

  const next = updated as TaskRow;
  if (next.contact_id) {
    await emitTaskCompleted({
      db,
      accountId: input.accountId,
      contactId: next.contact_id,
      payload: { task_id: next.id, title: next.title },
      idempotencyKey: `task_completed:${next.id}`,
    });
  }

  return { completed: true, task: next };
}
