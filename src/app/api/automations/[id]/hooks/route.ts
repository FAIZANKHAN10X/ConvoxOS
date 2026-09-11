import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  createAutomationHook,
  hookUrlFromToken,
  publicHookFromRow,
} from '@/lib/integrations/hooks';
import { supabaseAdmin } from '@/lib/supabase/admin';

const PUBLIC_COLUMNS =
  'id, automation_id, is_active, last_received_at, created_at, token_enc';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await getCurrentAccount();
    const { data, error } = await ctx.supabase
      .from('automation_inbound_hooks')
      .select(PUBLIC_COLUMNS)
      .eq('account_id', ctx.accountId)
      .eq('automation_id', id)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) return NextResponse.json({ hook: null });
    const origin = new URL(request.url).origin;
    return NextResponse.json({
      hook: publicHookFromRow(data as Record<string, unknown>, origin),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireRole('agent');
    const { data: automation, error } = await ctx.supabase
      .from('automations')
      .select('id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error || !automation) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const created = await createAutomationHook(supabaseAdmin(), {
      accountId: ctx.accountId,
      automationId: id,
      createdBy: ctx.userId,
    });
    const origin = new URL(request.url).origin;
    return NextResponse.json(
      {
        hook: {
          id: created.id,
          automation_id: id,
          url: hookUrlFromToken(origin, created.token),
          token: created.token,
          secret: created.secret,
          is_active: true,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
