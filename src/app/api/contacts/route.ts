import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { emitContactCreated } from '@/lib/automation/crm-events';
import { findOrCreateContact } from '@/lib/api/v1/contacts';

/**
 * POST /api/contacts — dashboard manual contact create.
 * Session-authed; reuses the v1 find-or-create (fuzzy dedupe +
 * unique-violation race backstop) so manual creates are
 * indistinguishable from API ones. Emits contact_created(manual)
 * when a row is actually created (not on dedupe hits).
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
    if (!phone) {
      return NextResponse.json({ error: 'phone is required' }, { status: 400 });
    }

    const { id, created } = await findOrCreateContact(
      ctx.supabase,
      ctx.accountId,
      ctx.userId,
      {
        phone,
        name: typeof body?.name === 'string' ? body.name : undefined,
        email: typeof body?.email === 'string' ? body.email : undefined,
        company: typeof body?.company === 'string' ? body.company : undefined,
      }
    );

    if (created) {
      await emitContactCreated({
        db: ctx.supabase,
        accountId: ctx.accountId,
        contactId: id,
        payload: { source: 'manual' },
        idempotencyKey: `contact_created:${id}`,
        source: 'crm',
      });
    }

    const { data: contact } = await ctx.supabase
      .from('contacts')
      .select('id, name, email, phone, company')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    return NextResponse.json({ contact, created }, { status: created ? 201 : 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
