import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { emitContactUpdated } from '@/lib/automation/crm-events';
import {
  ContactWriteError,
  hashPatch,
  updateContact,
} from '@/lib/contacts/write';

/**
 * PATCH /api/contacts/[id] — dashboard manual contact update.
 * Session-authed; writes through the shared domain writer and
 * emits contact_updated(manual) when fields actually change, so
 * UI edits participate in automation like every other path.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: contactId } = await params;
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'body must be an object' }, { status: 400 });
    }

    const patch: Record<string, string | null | undefined> = {};
    for (const field of ['name', 'email', 'phone', 'company'] as const) {
      if (!(field in body)) continue;
      const value = body[field];
      if (value === null || typeof value === 'string') {
        patch[field] = value;
      } else {
        return NextResponse.json(
          { error: `'${field}' must be a string or null` },
          { status: 400 }
        );
      }
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'no fields to update' }, { status: 400 });
    }

    const result = await updateContact(ctx.supabase, {
      accountId: ctx.accountId,
      contactId,
      patch,
    });

    if (result.changedFields.length > 0) {
      await emitContactUpdated({
        db: ctx.supabase,
        accountId: ctx.accountId,
        contactId,
        payload: { fields: result.changedFields, source: 'manual' },
        idempotencyKey: `contact_updated:${contactId}:manual:${hashPatch(patch)}`,
        source: 'crm',
      });
    }

    return NextResponse.json({
      contact: result.contact,
      updated: result.changedFields,
    });
  } catch (error) {
    if (error instanceof ContactWriteError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return toErrorResponse(error);
  }
}
