import { z } from 'zod';
import type { ToolDefinition } from './types';

import { emitDealCreated, emitDealStageChanged } from '@/lib/automation/crm-events';
import { createDeal, DealWriteError, moveDealStage } from '@/lib/deals/write';

export const createDealTool: ToolDefinition = {
  name: 'create_deal',
  description: 'Create a deal/opportunity for the current contact. Requires pipeline and stage to exist for this account.',
  permission: 'WRITE',
  schema: z.object({
    title: z.string().min(1).max(120),
    pipelineId: z.string().uuid().optional(),
    stageId: z.string().uuid().optional(),
    value: z.number().min(0).max(1_000_000_000).optional(),
    contactId: z.string().uuid().optional(),
  }),
  handler: async (args, ctx) => {
    const a = args as { title: string; pipelineId?: string; stageId?: string; value?: number; contactId?: string };
    const contactId = a.contactId ?? ctx.contactId;
    // Verify contact belongs to account if provided
    if (contactId) {
      const { data: contact } = await ctx.supabase.from('contacts').select('id').eq('id', contactId).eq('account_id', ctx.accountId).maybeSingle();
      if (!contact) return { success: false, error: 'Contact not found' };
    }
    let pipelineId = a.pipelineId;
    let stageId = a.stageId;
    // If pipeline not specified, use account's first pipeline
    if (!pipelineId) {
      const { data: pipeline } = await ctx.supabase.from('pipelines').select('id').eq('account_id', ctx.accountId).order('created_at').limit(1).maybeSingle();
      if (!pipeline) return { success: false, error: 'No pipeline found for this account' };
      pipelineId = pipeline.id;
    } else {
      const { data: p } = await ctx.supabase.from('pipelines').select('id').eq('id', pipelineId).eq('account_id', ctx.accountId).maybeSingle();
      if (!p) return { success: false, error: 'Pipeline not found' };
    }
    if (!stageId) {
      const { data: stage } = await ctx.supabase.from('pipeline_stages').select('id').eq('pipeline_id', pipelineId).order('position').limit(1).maybeSingle();
      if (!stage) return { success: false, error: 'No stage found for pipeline' };
      stageId = stage.id;
    } else {
      const { data: s } = await ctx.supabase.from('pipeline_stages').select('id').eq('id', stageId).eq('pipeline_id', pipelineId).maybeSingle();
      if (!s) return { success: false, error: 'Stage not found for pipeline' };
    }
    // Idempotency: if a deal with same contact+title was created in last 5 minutes, return it
    // This prevents duplicate deals on webhook/Agent retry with same inbound.
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: recent } = await ctx.supabase
      .from('deals')
      .select('id, title, created_at')
      .eq('account_id', ctx.accountId)
      .eq('contact_id', contactId ?? '')
      .eq('title', a.title.trim())
      .gte('created_at', fiveMinAgo)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recent) return { success: true, data: { dealId: (recent as { id: string }).id, title: (recent as { title: string }).title, deduped: true } };

    // Writes go through the shared domain writer so AI-created
    // deals emit deal_created for automations like every path.
    const { data: owner } = await ctx.supabase
      .from('accounts')
      .select('owner_user_id')
      .eq('id', ctx.accountId)
      .maybeSingle();
    const creatorId = (owner as { owner_user_id: string } | null)?.owner_user_id;
    if (!creatorId) return { success: false, error: 'Cannot determine deal creator' };
    // The untyped client leaves pipeline/stage as string|undefined;
    // narrow explicitly before the writer call.
    const resolvedPipelineId = pipelineId;
    const resolvedStageId = stageId;
    if (!resolvedPipelineId || !resolvedStageId) {
      return { success: false, error: 'No pipeline/stage found for this account' };
    }
    let deal: Awaited<ReturnType<typeof createDeal>>;
    try {
      deal = await createDeal(ctx.supabase, {
        accountId: ctx.accountId,
        userId: creatorId,
        pipelineId: resolvedPipelineId,
        stageId: resolvedStageId,
        contactId: contactId ?? null,
        title: a.title.trim(),
        value: a.value,
      });
    } catch (error) {
      if (error instanceof DealWriteError) {
        return { success: false, error: error.message };
      }
      return { success: false, error: 'Failed to create deal' };
    }
    if (deal.contact_id) {
      await emitDealCreated({
        db: ctx.supabase,
        accountId: ctx.accountId,
        contactId: deal.contact_id,
        dealId: deal.id,
        payload: {
          deal_id: deal.id,
          pipeline_id: deal.pipeline_id,
          stage_id: deal.stage_id,
          source: 'ai',
        },
        idempotencyKey: `deal_created:${deal.id}`,
        source: 'crm',
      });
    }
    return { success: true, data: { dealId: deal.id, title: deal.title } };
  },
};

export const moveDealStageTool: ToolDefinition = {
  name: 'move_deal_stage',
  description: 'Move a deal to a different stage.',
  permission: 'WRITE',
  schema: z.object({
    dealId: z.string().uuid(),
    stageId: z.string().uuid(),
  }),
  handler: async (args, ctx) => {
    const { dealId, stageId } = args as { dealId: string; stageId: string };
    // Route through the shared writer + emission so AI stage moves
    // emit deal_stage_changed like every other path.
    let moved: Awaited<ReturnType<typeof moveDealStage>>;
    try {
      moved = await moveDealStage(ctx.supabase, {
        accountId: ctx.accountId,
        dealId,
        stageId,
      });
    } catch (error) {
      if (error instanceof DealWriteError) {
        return { success: false, error: error.message };
      }
      return { success: false, error: 'Failed to move deal' };
    }
    if (moved.moved && moved.deal.contact_id) {
      await emitDealStageChanged({
        db: ctx.supabase,
        accountId: ctx.accountId,
        contactId: moved.deal.contact_id,
        dealId: moved.deal.id,
        payload: {
          deal_id: moved.deal.id,
          pipeline_id: moved.deal.pipeline_id,
          from_stage_id: moved.fromStageId,
          to_stage_id: moved.deal.stage_id,
          source: 'ai',
        },
        idempotencyKey: `deal_stage_changed:${moved.deal.id}:${moved.fromStageId}:${moved.deal.stage_id}`,
        source: 'crm',
      });
    }
    return { success: true, data: { dealId, stageId, moved: moved.moved } };
  },
};
