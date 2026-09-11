import type { SupabaseClient } from '@supabase/supabase-js';

export class DealWriteError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'DealWriteError';
    this.status = status;
  }
}

export interface DealRow {
  id: string;
  account_id: string;
  pipeline_id: string;
  stage_id: string;
  contact_id: string | null;
  title: string;
  status: string;
}

async function getDeal(
  db: SupabaseClient,
  accountId: string,
  dealId: string
): Promise<DealRow | null> {
  const { data, error } = await db
    .from('deals')
    .select('id, account_id, pipeline_id, stage_id, contact_id, title, status')
    .eq('id', dealId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error || !data) return null;
  return data as DealRow;
}

export async function getLatestOpenDeal(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<DealRow | null> {
  const { data, error } = await db
    .from('deals')
    .select('id, account_id, pipeline_id, stage_id, contact_id, title, status')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('status', 'open')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as DealRow;
}

export interface MoveDealResult {
  moved: boolean;
  deal: DealRow;
  fromStageId: string;
}

/**
 * Move a deal to another stage of its own pipeline. Pure DB write —
 * the caller emits `deal_stage_changed` with the right source, since
 * UI paths (source `crm`, via the deals API route) and automation
 * nodes (source `automation`) differ. Returns `moved: false` when the
 * deal is already in the target stage (no event should fire).
 */
export async function moveDealStage(
  db: SupabaseClient,
  input: { accountId: string; dealId: string; stageId: string }
): Promise<MoveDealResult> {
  const deal = await getDeal(db, input.accountId, input.dealId);
  if (!deal) throw new DealWriteError('Deal not found', 404);
  if (deal.stage_id === input.stageId) return { moved: false, deal, fromStageId: deal.stage_id };

  const { data: stage, error: stageError } = await db
    .from('pipeline_stages')
    .select('id')
    .eq('id', input.stageId)
    .eq('pipeline_id', deal.pipeline_id)
    .maybeSingle();
  if (stageError || !stage) {
    throw new DealWriteError('Stage not found for deal pipeline', 400);
  }

  const { data: updated, error } = await db
    .from('deals')
    .update({ stage_id: input.stageId })
    .eq('id', input.dealId)
    .eq('account_id', input.accountId)
    .select('id, account_id, pipeline_id, stage_id, contact_id, title, status')
    .single();
  if (error || !updated) {
    throw new DealWriteError(
      `Failed to move deal: ${error?.message ?? 'no row'}`
    );
  }
  return {
    moved: true,
    deal: updated as DealRow,
    fromStageId: deal.stage_id,
  };
}
