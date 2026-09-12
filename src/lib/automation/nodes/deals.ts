import { z } from 'zod';

import {
  createDeal,
  DealWriteError,
  getLatestOpenDeal,
  setDealStatus,
  updateDeal,
  type DealStatus,
} from '@/lib/deals/write';

import { DOMAIN_EVENT } from '../event-types';
import { enqueueDomainEventWithClient } from '../events';
import type { NodeDefinition } from '../types';
import { asDb } from './db';

const createDealConfig = z.object({
  title: z.string().min(1).max(120),
  pipelineId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  value: z.number().min(0).max(1_000_000_000).optional(),
  contactId: z.string().uuid().optional(),
});

async function firstPipelineStage(
  db: ReturnType<typeof asDb>,
  accountId: string,
  pipelineId?: string,
  stageId?: string
): Promise<{ pipelineId: string; stageId: string }> {
  let pid = pipelineId;
  if (!pid) {
    const { data: pipeline } = await db
      .from('pipelines')
      .select('id')
      .eq('account_id', accountId)
      .order('created_at')
      .limit(1)
      .maybeSingle();
    pid = (pipeline as { id: string } | null)?.id ?? undefined;
  }
  if (!pid) throw new DealWriteError('No pipeline found for this account', 400);
  let sid = stageId;
  if (!sid) {
    const { data: stage } = await db
      .from('pipeline_stages')
      .select('id')
      .eq('pipeline_id', pid)
      .order('position')
      .limit(1)
      .maybeSingle();
    sid = (stage as { id: string } | null)?.id ?? undefined;
  }
  if (!sid) throw new DealWriteError('No stage found for pipeline', 400);
  return { pipelineId: pid, stageId: sid };
}

export const createDealAction: NodeDefinition<z.infer<typeof createDealConfig>> = {
  type: 'action.create_deal',
  kind: 'action',
  label: 'Create deal',
  description: "Create an opportunity for the contact",
  category: 'crm',
  configSchema: createDealConfig,
  summarize(config) {
    const title = config.title?.trim();
    return title ? `Deal: ${title.length > 48 ? `${title.slice(0, 48)}…` : title}` : 'Create a deal';
  },
  async execute(ctx, config) {
    const db = asDb(ctx);
    const contactId = config.contactId ?? ctx.contactId;
    // `deals.user_id` is NOT NULL (creator audit). Same fallback as
    // the create-task node: the account owner.
    const { data: account } = await db
      .from('accounts')
      .select('owner_user_id')
      .eq('id', ctx.accountId)
      .maybeSingle();
    const creatorId = (account as { owner_user_id: string } | null)?.owner_user_id ?? null;
    if (!creatorId) {
      return { status: 'fail', error: 'cannot determine deal creator' };
    }
    let deal;
    try {
      const { pipelineId, stageId } = await firstPipelineStage(
        db,
        ctx.accountId,
        config.pipelineId,
        config.stageId
      );
      deal = await createDeal(db, {
        accountId: ctx.accountId,
        userId: creatorId,
        pipelineId,
        stageId,
        contactId,
        title: config.title,
        value: config.value,
      });
    } catch (error) {
      if (error instanceof DealWriteError) {
        return { status: 'fail', error: error.message };
      }
      throw error;
    }

    if (deal.contact_id) {
      await enqueueDomainEventWithClient(db, {
        accountId: ctx.accountId,
        eventType: DOMAIN_EVENT.DEAL_CREATED,
        contactId: deal.contact_id,
        payload: {
          deal_id: deal.id,
          pipeline_id: deal.pipeline_id,
          stage_id: deal.stage_id,
        },
        source: 'automation',
        originRunId: ctx.runId,
        causationEventId: ctx.event.id,
        chainDepth: ctx.event.chainDepth + 1,
        idempotencyKey: `deal_created:${ctx.runId}:${deal.id}`,
      });
    }

    return {
      status: 'ok',
      output: { dealId: deal.id, title: deal.title },
    };
  },
};

const updateDealConfig = z.object({
  dealId: z.string().uuid().optional(),
  title: z.string().min(1).max(120).optional(),
  value: z.number().min(0).max(1_000_000_000).optional(),
});

async function resolveDealId(
  db: ReturnType<typeof asDb>,
  accountId: string,
  contactId: string,
  dealId?: string
): Promise<string | null> {
  if (dealId) return dealId;
  const latest = await getLatestOpenDeal(db, accountId, contactId);
  return latest?.id ?? null;
}

export const updateDealAction: NodeDefinition<z.infer<typeof updateDealConfig>> = {
  type: 'action.update_deal',
  kind: 'action',
  label: 'Update deal',
  description: "Update the contact's deal title or value",
  category: 'crm',
  configSchema: updateDealConfig,
  summarize() {
    return 'Update deal';
  },
  async execute(ctx, config) {
    const db = asDb(ctx);
    const dealId = await resolveDealId(db, ctx.accountId, ctx.contactId, config.dealId);
    if (!dealId) {
      return { status: 'fail', error: 'contact has no open deal' };
    }
    if (config.title === undefined && config.value === undefined) {
      return { status: 'fail', error: 'no fields to update' };
    }

    let result: Awaited<ReturnType<typeof updateDeal>>;
    try {
      result = await updateDeal(db, {
        accountId: ctx.accountId,
        dealId,
        patch: { title: config.title, value: config.value },
      });
    } catch (error) {
      if (error instanceof DealWriteError) {
        return { status: 'fail', error: error.message };
      }
      throw error;
    }

    if (result.changedFields.length > 0 && result.deal.contact_id) {
      await enqueueDomainEventWithClient(db, {
        accountId: ctx.accountId,
        eventType: DOMAIN_EVENT.DEAL_UPDATED,
        contactId: result.deal.contact_id,
        payload: {
          deal_id: result.deal.id,
          pipeline_id: result.deal.pipeline_id,
          fields: result.changedFields,
        },
        source: 'automation',
        originRunId: ctx.runId,
        causationEventId: ctx.event.id,
        chainDepth: ctx.event.chainDepth + 1,
        idempotencyKey: `deal_updated:${ctx.runId}:${result.deal.id}:${result.changedFields.join(',')}`,
      });
    }

    return {
      status: 'ok',
      output: { dealId: result.deal.id, updated: result.changedFields },
    };
  },
};

const setDealStatusConfig = z.object({
  dealId: z.string().uuid().optional(),
  status: z.enum(['open', 'won', 'lost']),
  lostReason: z.string().max(500).optional(),
});

export const setDealStatusAction: NodeDefinition<
  z.infer<typeof setDealStatusConfig>
> = {
  type: 'action.set_deal_status',
  kind: 'action',
  label: 'Set deal status',
  description: "Mark the contact's deal open, won, or lost",
  category: 'crm',
  configSchema: setDealStatusConfig,
  summarize(config) {
    return `Deal → ${config.status}`;
  },
  async execute(ctx, config) {
    const db = asDb(ctx);
    const dealId = await resolveDealId(db, ctx.accountId, ctx.contactId, config.dealId);
    if (!dealId) {
      return { status: 'fail', error: 'contact has no open deal' };
    }

    let result: Awaited<ReturnType<typeof setDealStatus>>;
    try {
      result = await setDealStatus(db, {
        accountId: ctx.accountId,
        dealId,
        status: config.status as DealStatus,
        lostReason: config.lostReason,
      });
    } catch (error) {
      if (error instanceof DealWriteError) {
        return { status: 'fail', error: error.message };
      }
      throw error;
    }

    if (result.changed && result.deal.contact_id) {
      await enqueueDomainEventWithClient(db, {
        accountId: ctx.accountId,
        eventType: DOMAIN_EVENT.DEAL_STATUS_CHANGED,
        contactId: result.deal.contact_id,
        payload: {
          deal_id: result.deal.id,
          pipeline_id: result.deal.pipeline_id,
          from_status: result.fromStatus,
          to_status: result.deal.status,
          lost_reason: config.status === 'lost' ? (config.lostReason ?? null) : null,
        },
        source: 'automation',
        originRunId: ctx.runId,
        causationEventId: ctx.event.id,
        chainDepth: ctx.event.chainDepth + 1,
        idempotencyKey: `deal_status_changed:${ctx.runId}:${result.deal.id}:${result.fromStatus}:${result.deal.status}`,
      });
    }

    return {
      status: 'ok',
      output: { dealId: result.deal.id, status: result.deal.status },
    };
  },
};
