import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

/**
 * GET /api/forms/[id]/submissions — recent submissions for a form
 * (keyset-bounded, newest first). Contact embedded for display.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: formId } = await params;
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      Math.max(Number(searchParams.get('limit') ?? 50) || 50, 1),
      100
    );
    const { data: form, error: formError } = await ctx.supabase
      .from('lead_forms')
      .select('id')
      .eq('id', formId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (formError || !form) {
      return NextResponse.json({ error: 'Form not found' }, { status: 404 });
    }
    const { data, error } = await ctx.supabase
      .from('form_submissions')
      .select(
        'id, values, attribution, created_at, contact:contacts(id, name, phone, email)'
      )
      .eq('form_id', formId)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return NextResponse.json({ submissions: data ?? [] });
  } catch (error) {
    return toErrorResponse(error);
  }
}
