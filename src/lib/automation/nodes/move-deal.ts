import { z } from 'zod';

import { DealWriteError, getLatestOpenDeal, moveDealStage } from '@/lib/deals/write';

import { DOMAIN_EVENT } from '../event-types';
import { enqueueDomainEventWithClient } from '../events';
import type { NodeDefinition } from '../types';
import { asDb } from './db';

const moveDealConfig = z.object({
  dealId: z.string().uuid().optional(),
  stageId: z.string().uuid(),
});

export const moveDealAction: NodeDefinition<z.infer<typeof moveDealConfig>> = {
  type: 'action.move_deal',
  kind: 'action',
  label: 'Move deal',
  description: "Move the contact's deal to another stage",
  category: 'crm',
  configSchema: moveDealConfig,
  summarize() {
    return 'Move deal to stage';
  },
  async execute(ctx, config) {
    const db = asDb(ctx);
    let dealId = config.dealId;
    if (!dealId) {
      const latest = await getLatestOpenDeal(db, ctx.accountId, ctx.contactId);
      if (!latest) {
        return { status: 'fail', error: 'contact has no open deal' };
      }
      dealId = latest.id;
    }

    let moved: Awaited<ReturnType<typeof moveDealStage>>;
    try {
      moved = await moveDealStage(db, {
        accountId: ctx.accountId,
        dealId,
        stageId: config.stageId,
      });
    } catch (error) {
      if (error instanceof DealWriteError) {
        return { status: 'fail', error: error.message };
      }
      throw error;
    }

    if (moved.moved && moved.deal.contact_id) {
      await enqueueDomainEventWithClient(db, {
        accountId: ctx.accountId,
        eventType: DOMAIN_EVENT.DEAL_STAGE_CHANGED,
        contactId: moved.deal.contact_id,
        payload: {
          deal_id: moved.deal.id,
          pipeline_id: moved.deal.pipeline_id,
          from_stage_id: moved.fromStageId,
          to_stage_id: moved.deal.stage_id,
        },
        source: 'automation',
        originRunId: ctx.runId,
        causationEventId: ctx.event.id,
        chainDepth: ctx.event.chainDepth + 1,
        idempotencyKey: `deal_stage_changed:${ctx.runId}:${moved.deal.id}:${moved.fromStageId}:${moved.deal.stage_id}`,
      });
    }

    return {
      status: 'ok',
      output: {
        dealId: moved.deal.id,
        stageId: moved.deal.stage_id,
        moved: moved.moved,
      },
    };
  },
};
