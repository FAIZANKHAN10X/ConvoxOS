import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { emitDealCreated } from '@/lib/automation/crm-events';
import { createDeal, DealWriteError } from '@/lib/deals/write';

/**
 * POST /api/deals — dashboard manual deal create. Session-authed;
 * writes through the shared domain writer and emits
 * `deal_created(manual)` so manual creates participate in
 * automation like every other path.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'body must be an object' }, { status: 400 });
    }

    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    const title = str(body.title)?.trim();
    const pipelineId = str(body.pipeline_id);
    const stageId = str(body.stage_id);
    const contactId = str(body.contact_id);
    if (!title || !pipelineId || !stageId || !contactId) {
      return NextResponse.json(
        { error: 'title, pipeline_id, stage_id, and contact_id are required' },
        { status: 400 }
      );
    }
    const value =
      typeof body.value === 'number' && Number.isFinite(body.value)
        ? body.value
        : undefined;

    const deal = await createDeal(ctx.supabase, {
      accountId: ctx.accountId,
      userId: ctx.userId,
      pipelineId,
      stageId,
      contactId,
      title,
      value,
      currency: str(body.currency),
      assignedTo: body.assigned_to === null ? null : str(body.assigned_to),
      notes: body.notes === null ? null : str(body.notes),
      expectedCloseDate:
        body.expected_close_date === null
          ? null
          : str(body.expected_close_date),
    });

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
          source: 'manual',
        },
        idempotencyKey: `deal_created:${deal.id}`,
        source: 'crm',
      });
    }

    return NextResponse.json({ deal }, { status: 201 });
  } catch (error) {
    if (error instanceof DealWriteError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return toErrorResponse(error);
  }
}
