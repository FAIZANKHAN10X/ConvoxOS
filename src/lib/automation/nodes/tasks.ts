import { z } from 'zod';

import { getAccountMember } from '@/lib/members';
import { completeTask, createTask, TaskWriteError } from '@/lib/tasks/write';

import type { NodeDefinition } from '../types';
import { asDb } from './db';

const createTaskConfig = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  dueAt: z.string().datetime().optional(),
  assigneeProfileId: z.string().uuid().optional(),
});

export const createTaskAction: NodeDefinition<z.infer<typeof createTaskConfig>> = {
  type: 'action.create_task',
  kind: 'action',
  label: 'Create task',
  description: "Create a follow-up task for the contact",
  category: 'crm',
  configSchema: createTaskConfig,
  summarize(config) {
    const title = config.title?.trim();
    return title ? `Task: ${title.length > 48 ? `${title.slice(0, 48)}…` : title}` : 'Create a task';
  },
  async execute(ctx, config) {
    const db = asDb(ctx);
    let assignedTo: string | null = null;
    if (config.assigneeProfileId) {
      const member = await getAccountMember(
        db,
        ctx.accountId,
        config.assigneeProfileId
      );
      if (!member) {
        return { status: 'fail', error: 'assignee is not an account member' };
      }
      assignedTo = member.userId;
    }
    // `tasks.user_id` records the creator for audit. Prefer the
    // assignee; otherwise the account owner (system-owned fallback).
    let creatorId = assignedTo;
    if (!creatorId) {
      const { data: account } = await db
        .from('accounts')
        .select('owner_user_id')
        .eq('id', ctx.accountId)
        .maybeSingle();
      creatorId = (account as { owner_user_id: string } | null)?.owner_user_id ?? null;
    }
    if (!creatorId) {
      return { status: 'fail', error: 'cannot determine task creator' };
    }

    try {
      const task = await createTask(db, {
        accountId: ctx.accountId,
        userId: creatorId,
        contactId: ctx.contactId,
        assignedTo,
        title: config.title,
        description: config.description,
        dueAt: config.dueAt,
        sourceAutomationId: ctx.automationId,
      });
      return {
        status: 'ok',
        output: { taskId: task.id, title: task.title },
      };
    } catch (error) {
      if (error instanceof TaskWriteError) {
        return { status: 'fail', error: error.message };
      }
      throw error;
    }
  },
};

const completeTaskConfig = z.object({
  taskId: z.string().uuid().optional(),
});

export const completeTaskAction: NodeDefinition<
  z.infer<typeof completeTaskConfig>
> = {
  type: 'action.complete_task',
  kind: 'action',
  label: 'Complete task',
  description: "Mark the contact's open task complete",
  category: 'crm',
  configSchema: completeTaskConfig,
  summarize() {
    return 'Complete task';
  },
  async execute(ctx, config) {
    const db = asDb(ctx);
    let taskId = config.taskId;
    if (!taskId) {
      const { data, error } = await db
        .from('tasks')
        .select('id')
        .eq('account_id', ctx.accountId)
        .eq('contact_id', ctx.contactId)
        .eq('status', 'open')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error || !data) {
        return { status: 'fail', error: 'contact has no open task' };
      }
      taskId = (data as { id: string }).id;
    }

    try {
      const { completed, task } = await completeTask(db, {
        accountId: ctx.accountId,
        taskId,
      });
      return {
        status: 'ok',
        output: { taskId: task?.id ?? taskId, completed },
      };
    } catch (error) {
      if (error instanceof TaskWriteError) {
        return { status: 'fail', error: error.message };
      }
      throw error;
    }
  },
};
