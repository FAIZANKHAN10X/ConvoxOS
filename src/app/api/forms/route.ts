import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  createLeadForm,
  FormWriteError,
  normalizeFormFields,
} from '@/lib/forms/write';

/**
 * GET /api/forms — list the account's lead forms (newest first,
 * bounded). POST — create a form (field schema validated; the raw
 * public token is returned once and never stored).
 */
export async function GET() {
  try {
    const ctx = await requireRole('agent');
    const { data, error } = await ctx.supabase
      .from('lead_forms')
      .select('id, name, fields, is_active, created_at')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return NextResponse.json({ forms: data ?? [] });
  } catch (error) {
    return toErrorResponse(error);
  }
}

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
    if (typeof body.name !== 'string') {
      return NextResponse.json({ error: "'name' is required" }, { status: 400 });
    }
    // Validate early for a clean 400 before the writer runs.
    normalizeFormFields(body.fields);
    const { form, token } = await createLeadForm(ctx.supabase, {
      accountId: ctx.accountId,
      userId: ctx.userId,
      name: body.name,
      fields: body.fields,
    });
    return NextResponse.json({ form, token }, { status: 201 });
  } catch (error) {
    if (error instanceof FormWriteError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return toErrorResponse(error);
  }
}
