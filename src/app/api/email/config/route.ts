import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  connectEmail,
  disconnectEmail,
  EmailConfigError,
} from '@/lib/email/config';

/**
 * GET /api/email/config — safe status (never returns the API key).
 * POST — validate the Resend key + from address, persist encrypted,
 * return the one-time webhook secret + URL for the Resend dashboard.
 * DELETE — disconnect (history preserved).
 * Admin-only writes, mirroring the telegram config route.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer');
    const { data: config, error } = await supabase
      .from('email_config')
      .select('id, from_address, from_name, status, connected_at, updated_at')
      .eq('account_id', accountId)
      .maybeSingle();
    if (error) throw error;
    if (!config) {
      return NextResponse.json({ connected: false, reason: 'no_config' });
    }
    return NextResponse.json({
      connected: (config as { status: string }).status === 'connected',
      config,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (
      typeof body?.api_key !== 'string' ||
      typeof body?.from_address !== 'string'
    ) {
      return NextResponse.json(
        { error: "'api_key' and 'from_address' are required" },
        { status: 400 }
      );
    }
    const origin =
      process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
      request.headers.get('origin') ||
      '';
    const { config, webhookSecret, webhookUrl } = await connectEmail(supabase, {
      accountId,
      userId,
      apiKey: body.api_key,
      fromAddress: body.from_address,
      fromName:
        typeof body.from_name === 'string' ? body.from_name : undefined,
      appOrigin: origin.replace(/\/$/, ''),
    });
    return NextResponse.json({ config, webhookSecret, webhookUrl });
  } catch (error) {
    if (error instanceof EmailConfigError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return toErrorResponse(error);
  }
}

export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin');
    await disconnectEmail(supabase, accountId);
    return NextResponse.json({ disconnected: true });
  } catch (error) {
    if (error instanceof EmailConfigError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return toErrorResponse(error);
  }
}
