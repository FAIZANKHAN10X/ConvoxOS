import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  createIntegrationEndpoint,
  INTEGRATION_SECRET_PREFIX,
} from '@/lib/integrations/endpoints';
import { normalizeWebhookUrl } from '@/lib/webhooks/endpoints';

const PUBLIC_COLUMNS =
  'id, name, kind, url, is_active, last_delivery_at, failure_count, created_at';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const { data, error } = await ctx.supabase
      .from('integration_endpoints')
      .select(PUBLIC_COLUMNS)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ endpoints: data ?? [] });
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
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    const url = normalizeWebhookUrl(body?.url);
    if (!url) {
      return NextResponse.json(
        { error: 'url must be a valid https:// URL' },
        { status: 400 }
      );
    }
    const kind = body?.kind === 'generic' ? 'generic' : 'n8n';
    const created = await createIntegrationEndpoint(ctx.supabase, {
      accountId: ctx.accountId,
      createdBy: ctx.userId,
      name,
      kind,
      url,
    });
    return NextResponse.json(
      {
        endpoint: {
          id: created.id,
          name,
          kind,
          url,
          secret: created.secret,
          secret_prefix: INTEGRATION_SECRET_PREFIX,
          is_active: true,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
