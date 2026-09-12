import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { FormWriteError, updateLeadForm } from '@/lib/forms/write';

/**
 * PATCH /api/forms/[id] — rename, replace the field schema, or
 * toggle active. DELETE — remove the form and its submissions
 * (admin only, matching the automations convention).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: formId } = await params;
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'body must be an object' }, { status: 400 });
    }
    if (
      body.name !== undefined && typeof body.name !== 'string' ||
      body.isActive !== undefined && typeof body.isActive !== 'boolean'
    ) {
      return NextResponse.json({ error: 'invalid fields' }, { status: 400 });
    }
    const form = await updateLeadForm(ctx.supabase, {
      accountId: ctx.accountId,
      formId,
      name: typeof body.name === 'string' ? body.name : undefined,
      fields: body.fields,
      isActive: typeof body.isActive === 'boolean' ? body.isActive : undefined,
    });
    return NextResponse.json({ form });
  } catch (error) {
    if (error instanceof FormWriteError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');
    const { id: formId } = await params;
    const { error } = await ctx.supabase
      .from('lead_forms')
      .delete()
      .eq('id', formId)
      .eq('account_id', ctx.accountId);
    if (error) throw error;
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
