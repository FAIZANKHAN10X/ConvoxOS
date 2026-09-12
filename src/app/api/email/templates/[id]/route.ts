import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  EmailTemplateError,
  updateEmailTemplate,
} from '@/lib/email/templates';

/**
 * PATCH /api/email/templates/[id] — rename / edit subject+body.
 * DELETE — remove (admin only).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('agent');
    const { id: templateId } = await params;
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'body must be an object' }, { status: 400 });
    }
    const template = await updateEmailTemplate(ctx.supabase, {
      accountId: ctx.accountId,
      templateId,
      name: typeof body.name === 'string' ? body.name : undefined,
      subject: typeof body.subject === 'string' ? body.subject : undefined,
      bodyText: typeof body.body_text === 'string' ? body.body_text : undefined,
      bodyHtml:
        body.body_html === null || typeof body.body_html === 'string'
          ? body.body_html
          : undefined,
    });
    return NextResponse.json({ template });
  } catch (error) {
    if (error instanceof EmailTemplateError) {
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
    const { id: templateId } = await params;
    const { error } = await ctx.supabase
      .from('email_templates')
      .delete()
      .eq('id', templateId)
      .eq('account_id', ctx.accountId);
    if (error) throw error;
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
