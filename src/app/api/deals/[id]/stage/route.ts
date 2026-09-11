import { NextResponse } from 'next/server';

import { emitDealStageChanged } from '@/lib/automation/crm-events';
import { moveDealStage } from '@/lib/deals/write';
import { createClient } from '@/lib/supabase/server';

/**
 * PATCH /api/deals/[id]/stage — move a deal to another stage of its
 * own pipeline. Used by the board drag-drop and the deal form so
 * manual stage changes emit `deal_stage_changed` like the
 * `action.move_deal` automation node does. Session-authed (dashboard
 * users); account ownership enforced on every read and write.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: dealId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle();
  const accountId = (profile as { account_id: string } | null)?.account_id;
  if (!accountId) {
    return NextResponse.json({ error: 'No account' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const stageId =
    body && typeof body === 'object'
      ? (body as Record<string, unknown>).stage_id
      : null;
  if (typeof stageId !== 'string' || !stageId) {
    return NextResponse.json({ error: 'stage_id is required' }, { status: 400 });
  }

  let moved: Awaited<ReturnType<typeof moveDealStage>>;
  try {
    moved = await moveDealStage(supabase, {
      accountId,
      dealId,
      stageId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Move failed';
    const status =
      message === 'Deal not found'
        ? 404
        : message === 'Stage not found for deal pipeline'
          ? 400
          : 500;
    return NextResponse.json({ error: message }, { status });
  }

  if (moved.moved && moved.deal.contact_id) {
    await emitDealStageChanged({
      db: supabase,
      accountId,
      contactId: moved.deal.contact_id,
      dealId: moved.deal.id,
      payload: {
        deal_id: moved.deal.id,
        pipeline_id: moved.deal.pipeline_id,
        from_stage_id: moved.fromStageId,
        to_stage_id: moved.deal.stage_id,
      },
      idempotencyKey: `deal_stage_changed:${moved.deal.id}:${moved.fromStageId}:${moved.deal.stage_id}`,
    });
  }

  return NextResponse.json({
    deal: moved.deal,
    moved: moved.moved,
  });
}
