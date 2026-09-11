import { z } from 'zod';

import { getLatestOpenDeal } from '@/lib/deals/write';
import { getAccountMember } from '@/lib/members';

import type { NodeDefinition } from '../types';
import { asDb } from './db';

const assignOwnerConfig = z.object({
  target: z.enum(['conversation', 'task', 'deal']).default('conversation'),
  assigneeProfileId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
});

/**
 * Assign the run contact's conversation, open task, or open deal to
 * an account member. Members are picked as profiles (the only
 * account-scoped identity); conversations/tasks take the mapped
 * auth user id, deals take the profile id directly — matching how
 * the inbox, task, and deal UIs each store ownership today.
 */
export const assignOwnerAction: NodeDefinition<
  z.infer<typeof assignOwnerConfig>
> = {
  type: 'action.assign_owner',
  kind: 'action',
  label: 'Assign owner',
  description: "Assign the contact's thread, task, or deal",
  category: 'crm',
  configSchema: assignOwnerConfig,
  summarize() {
    return 'Assign owner';
  },
  async execute(ctx, config) {
    const db = asDb(ctx);
    const member = await getAccountMember(
      db,
      ctx.accountId,
      config.assigneeProfileId
    );
    if (!member) {
      return { status: 'fail', error: 'assignee is not an account member' };
    }

    if (config.target === 'conversation') {
      const { data, error } = await db
        .from('conversations')
        .select('id')
        .eq('account_id', ctx.accountId)
        .eq('contact_id', ctx.contactId)
        .maybeSingle();
      if (error || !data) {
        return { status: 'fail', error: 'contact has no conversation' };
      }
      if (!member.userId) {
        return { status: 'fail', error: 'assignee has no login user' };
      }
      const { error: updateError } = await db
        .from('conversations')
        .update({ assigned_agent_id: member.userId })
        .eq('id', (data as { id: string }).id)
        .eq('account_id', ctx.accountId);
      if (updateError) {
        return { status: 'fail', error: 'failed to assign conversation' };
      }
      return {
        status: 'ok',
        output: {
          conversationId: (data as { id: string }).id,
          assigneeProfileId: member.id,
        },
      };
    }

    if (config.target === 'task') {
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
      if (!member.userId) {
        return { status: 'fail', error: 'assignee has no login user' };
      }
      const { error } = await db
        .from('tasks')
        .update({ assigned_to: member.userId })
        .eq('id', taskId)
        .eq('account_id', ctx.accountId);
      if (error) {
        return { status: 'fail', error: 'failed to assign task' };
      }
      return {
        status: 'ok',
        output: { taskId, assigneeProfileId: member.id },
      };
    }

    let dealId = config.dealId;
    if (!dealId) {
      const latest = await getLatestOpenDeal(db, ctx.accountId, ctx.contactId);
      if (!latest) {
        return { status: 'fail', error: 'contact has no open deal' };
      }
      dealId = latest.id;
    } else {
      const { data, error } = await db
        .from('deals')
        .select('id')
        .eq('id', dealId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (error || !data) {
        return { status: 'fail', error: 'Deal not found' };
      }
    }
    const { error } = await db
      .from('deals')
      .update({ assigned_to: member.id })
      .eq('id', dealId)
      .eq('account_id', ctx.accountId);
    if (error) {
      return { status: 'fail', error: 'failed to assign deal' };
    }
    return {
      status: 'ok',
      output: { dealId, assigneeProfileId: member.id },
    };
  },
};
