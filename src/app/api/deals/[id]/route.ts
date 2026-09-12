import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { emitDealUpdated } from '@/lib/automation/crm-events';
import {
  DealWriteError,
  updateDeal,
  type UpdateDealPatch,
} from '@/lib/deals/write';

/**
 * PATCH /api/deals/[id] — dashboard manual deal update for generic
 * fields (title/value/currency/assignee/notes/close date). Stage
 * and status stay with their own routes. Emits `deal_updated`
 * when fields actually change.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: dealId } = await params;
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'body must be an object' }, { status: 400 });
    }

    const patch: UpdateDealPatch = {};
    if ('title' in body) {
      if (typeof body.title !== 'string') {
        return NextResponse.json({ error: "'title' must be a string" }, { status: 400 });
      }
      patch.title = body.title;
    }
    if ('value' in body) {
      if (typeof body.value !== 'number' || !Number.isFinite(body.value)) {
        return NextResponse.json({ error: "'value' must be a number" }, { status: 400 });
      }
      patch.value = body.value;
    }
    for (const [key, field] of [
      ['currency', 'currency'],
      ['assigned_to', 'assignedTo'],
      ['notes', 'notes'],
      ['expected_close_date', 'expectedCloseDate'],
    ] as const) {
      if (!(key in body)) continue;
      const v = body[key];
      if (v !== null && typeof v !== 'string') {
        return NextResponse.json(
          { error: `'${key}' must be a string or null` },
          { status: 400 }
        );
      }
      (patch as Record<string, string | null>)[field] = v as string | null;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'no fields to update' }, { status: 400 });
    }

    const result = await updateDeal(ctx.supabase, {
      accountId: ctx.accountId,
      dealId,
      patch,
    });

    if (result.changedFields.length > 0 && result.deal.contact_id) {
      await emitDealUpdated({
        db: ctx.supabase,
        accountId: ctx.accountId,
        contactId: result.deal.contact_id,
        dealId: result.deal.id,
        payload: {
          deal_id: result.deal.id,
          pipeline_id: result.deal.pipeline_id,
          fields: result.changedFields,
          source: 'manual',
        },
        idempotencyKey: `deal_updated:${result.deal.id}:manual:${result.changedFields.join(',')}`,
        source: 'crm',
      });
    }

    return NextResponse.json({
      deal: result.deal,
      updated: result.changedFields,
    });
  } catch (error) {
    if (error instanceof DealWriteError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return toErrorResponse(error);
  }
}
