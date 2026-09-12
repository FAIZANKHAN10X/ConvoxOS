import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { emitDealStatusChanged } from '@/lib/automation/crm-events';
import { DealWriteError, setDealStatus, type DealStatus } from '@/lib/deals/write';

const STATUSES: DealStatus[] = ['open', 'won', 'lost'];

/**
 * PATCH /api/deals/[id]/status — won/lost/reopen via the domain
 * writer. Emits `deal_status_changed` (source crm) when the status
 * actually changes, so T5 triggers can consume it. A lost deal
 * carries an optional free-text reason; reopening clears it.
 * Session-authed; account ownership enforced on every read/write.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: dealId } = await params;
    const body = (await request.json().catch(() => null)) as {
      status?: unknown;
      lost_reason?: unknown;
    } | null;

    if (typeof body?.status !== 'string' || !(STATUSES as string[]).includes(body.status)) {
      return NextResponse.json(
        { error: 'status must be one of: open, won, lost' },
        { status: 400 }
      );
    }
    const status = body.status as DealStatus;
    const lostReason =
      typeof body?.lost_reason === 'string' && body.lost_reason.trim()
        ? body.lost_reason.trim().slice(0, 500)
        : null;

    const result = await setDealStatus(ctx.supabase, {
      accountId: ctx.accountId,
      dealId,
      status,
      lostReason,
    });

    if (result.changed && result.deal.contact_id) {
      await emitDealStatusChanged({
        db: ctx.supabase,
        accountId: ctx.accountId,
        contactId: result.deal.contact_id,
        dealId: result.deal.id,
        payload: {
          deal_id: result.deal.id,
          pipeline_id: result.deal.pipeline_id,
          from_status: result.fromStatus,
          to_status: result.deal.status,
          lost_reason: status === 'lost' ? lostReason : null,
        },
        idempotencyKey: `deal_status_changed:${result.deal.id}:${result.fromStatus}:${result.deal.status}`,
      });
    }

    return NextResponse.json({
      deal: result.deal,
      changed: result.changed,
      ...(status === 'lost' ? { lost_reason: lostReason } : {}),
    });
  } catch (error) {
    if (error instanceof DealWriteError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return toErrorResponse(error);
  }
}
