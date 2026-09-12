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
  value: number;
}
const DEAL_COLUMNS =
  'id, account_id, pipeline_id, stage_id, contact_id, title, status, value';

async function getDeal(
  db: SupabaseClient,
  accountId: string,
  dealId: string
): Promise<DealRow | null> {
  const { data, error } = await db
    .from('deals')
    .select(DEAL_COLUMNS)
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
    .select(DEAL_COLUMNS)
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
    .select(DEAL_COLUMNS)
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

export type DealStatus = 'open' | 'won' | 'lost';

export interface SetDealStatusResult {
  changed: boolean;
  deal: DealRow;
  fromStatus: string;
}

/**
 * T4.5: set a deal's open/won/lost status with an optional lost
 * reason. Pure DB write — the caller emits `deal_status_changed`
 * (UI route does; automation paths will in T5). Returns
 * `changed: false` when the status is unchanged (no event).
 * Reopening clears a stale lost_reason.
 */
export async function setDealStatus(
  db: SupabaseClient,
  input: { accountId: string; dealId: string; status: DealStatus; lostReason?: string | null }
): Promise<SetDealStatusResult> {
  const deal = await getDeal(db, input.accountId, input.dealId);
  if (!deal) throw new DealWriteError('Deal not found', 404);
  if (deal.status === input.status) {
    return { changed: false, deal, fromStatus: deal.status };
  }
  const patch: Record<string, unknown> = { status: input.status };
  if (input.status === 'lost') {
    patch.lost_reason = input.lostReason?.trim() ? input.lostReason.trim() : null;
  } else {
    patch.lost_reason = null;
  }
  const { data: updated, error } = await db
    .from('deals')
    .update(patch)
    .eq('id', input.dealId)
    .eq('account_id', input.accountId)
    .select(DEAL_COLUMNS)
    .single();
  if (error || !updated) {
    throw new DealWriteError(
      `Failed to update deal status: ${error?.message ?? 'no row'}`
    );
  }
  return { changed: true, deal: updated as DealRow, fromStatus: deal.status };
}

export interface CreateDealInput {
  accountId: string;
  userId: string;
  pipelineId: string;
  stageId: string;
  contactId: string | null;
  title: string;
  value?: number;
  currency?: string;
  assignedTo?: string | null;
  notes?: string | null;
  expectedCloseDate?: string | null;
}

/**
 * Create a deal after verifying the pipeline, stage, and contact
 * all belong to the account (and the stage to the pipeline). Pure
 * DB write — the caller emits `deal_created` with the right source.
 */
export async function createDeal(
  db: SupabaseClient,
  input: CreateDealInput
): Promise<DealRow> {
  const title = input.title.trim();
  if (!title) throw new DealWriteError('Title is required', 400);

  const { data: pipeline, error: pipelineError } = await db
    .from('pipelines')
    .select('id')
    .eq('id', input.pipelineId)
    .eq('account_id', input.accountId)
    .maybeSingle();
  if (pipelineError || !pipeline) {
    throw new DealWriteError('Pipeline not found', 400);
  }

  const { data: stage, error: stageError } = await db
    .from('pipeline_stages')
    .select('id')
    .eq('id', input.stageId)
    .eq('pipeline_id', input.pipelineId)
    .maybeSingle();
  if (stageError || !stage) {
    throw new DealWriteError('Stage not found for deal pipeline', 400);
  }

  if (input.contactId) {
    const { data: contact, error: contactError } = await db
      .from('contacts')
      .select('id')
      .eq('id', input.contactId)
      .eq('account_id', input.accountId)
      .maybeSingle();
    if (contactError || !contact) {
      throw new DealWriteError('Contact not found', 404);
    }
  }

  const { data: created, error } = await db
    .from('deals')
    .insert({
      user_id: input.userId,
      account_id: input.accountId,
      pipeline_id: input.pipelineId,
      stage_id: input.stageId,
      contact_id: input.contactId,
      title,
      value: input.value ?? 0,
      currency: input.currency ?? 'USD',
      assigned_to: input.assignedTo ?? null,
      notes: input.notes?.trim() ? input.notes.trim() : null,
      expected_close_date: input.expectedCloseDate ?? null,
      status: 'open',
    })
    .select(DEAL_COLUMNS)
    .single();
  if (error || !created) {
    throw new DealWriteError(
      `Failed to create deal: ${error?.message ?? 'no row'}`
    );
  }
  return created as DealRow;
}

export interface UpdateDealPatch {
  title?: string | null;
  value?: number | null;
  currency?: string | null;
  assignedTo?: string | null;
  notes?: string | null;
  expectedCloseDate?: string | null;
}

/**
 * Validated partial deal update for generic fields (stage and
 * status stay with moveDealStage/setDealStatus). Values equal to
 * the stored row are skipped, so a no-op save performs no write
 * and emits nothing. Pure DB write — the caller emits
 * `deal_updated` when fields actually change.
 */
export async function updateDeal(
  db: SupabaseClient,
  input: { accountId: string; dealId: string; patch: UpdateDealPatch }
): Promise<{ deal: DealRow; changedFields: string[] }> {
  const existing = await getDeal(db, input.accountId, input.dealId);
  if (!existing) throw new DealWriteError('Deal not found', 404);

  const patch: Record<string, unknown> = {};
  if (input.patch.title !== undefined) {
    // deals.title is NOT NULL — an empty title is a 400, not a clear.
    const next =
      typeof input.patch.title === 'string' ? input.patch.title.trim() : '';
    if (!next) throw new DealWriteError('Title is required', 400);
    if (next !== existing.title) patch.title = next;
  }
  if (input.patch.value !== undefined) {
    const next =
      typeof input.patch.value === 'number' && Number.isFinite(input.patch.value)
        ? input.patch.value
        : 0;
    if (Number(next) !== Number(existing.value)) patch.value = next;
  }
  for (const [key, column] of [
    ['currency', 'currency'],
    ['assignedTo', 'assigned_to'],
    ['notes', 'notes'],
    ['expectedCloseDate', 'expected_close_date'],
  ] as const) {
    const value = input.patch[key];
    if (value === undefined) continue;
    const next =
      typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
    const current = (existing as unknown as Record<string, unknown>)[column];
    if ((current ?? null) !== next) patch[column] = next;
  }
  if (Object.keys(patch).length === 0) {
    return { deal: existing, changedFields: [] };
  }

  const { data: updated, error } = await db
    .from('deals')
    .update(patch)
    .eq('id', input.dealId)
    .eq('account_id', input.accountId)
    .select(DEAL_COLUMNS)
    .single();
  if (error || !updated) {
    throw new DealWriteError(
      `Failed to update deal: ${error?.message ?? 'no row'}`
    );
  }
  return { deal: updated as DealRow, changedFields: Object.keys(patch) };
}
