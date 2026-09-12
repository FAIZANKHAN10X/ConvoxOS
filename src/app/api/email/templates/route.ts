import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  createEmailTemplate,
  EmailTemplateError,
} from '@/lib/email/templates';

/**
 * GET /api/email/templates — list (bounded). POST — create a
 * template (subject + text or HTML body required).
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const { searchParams } = new URL(request.url);
    const limit = Math.min(
      Math.max(Number(searchParams.get('limit') ?? 100) || 100, 1),
      200
    );
    const { data, error } = await ctx.supabase
      .from('email_templates')
      .select('id, name, subject, body_text, body_html, created_at')
      .eq('account_id', ctx.accountId)
      .order('name')
      .limit(limit);
    if (error) throw error;
    return NextResponse.json({ templates: data ?? [] });
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
    const template = await createEmailTemplate(ctx.supabase, {
      accountId: ctx.accountId,
      userId: ctx.userId,
      name: body.name as string,
      subject: body.subject as string,
      bodyText: (body.body_text as string) ?? '',
      bodyHtml: (body.body_html as string | null | undefined) ?? null,
    });
    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    if (error instanceof EmailTemplateError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return toErrorResponse(error);
  }
}
