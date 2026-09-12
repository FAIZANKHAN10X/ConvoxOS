import { NextResponse, after } from 'next/server';

import { supabaseAdmin } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/crypto/encryption';
import { normalizeResendInbound, verifyResendWebhookSignature } from '@/lib/email/normalize';
import { processNormalizedInbound } from '@/lib/inbound/processNormalizedInbound';
import type { NormalizedInbound } from '@/lib/channels/types';

export const maxDuration = 60;

function isValidUUID(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/**
 * POST /api/email/webhook/[configId] — Resend (Svix-signed) inbound
 * + delivery events. Mirrors the telegram webhook posture: PK
 * config lookup, fail-closed signature verification, normalize →
 * processNormalizedInbound via after(). Unknown event types ack 200
 * (Resend retries otherwise).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ configId: string }> }
) {
  const { configId } = await params;
  if (!isValidUUID(configId)) {
    return NextResponse.json({ error: 'Invalid config id' }, { status: 400 });
  }

  const { data: config, error } = await supabaseAdmin()
    .from('email_config')
    .select('id, account_id, webhook_secret_encrypted')
    .eq('id', configId)
    .maybeSingle();
  if (error) {
    console.error('[email webhook] config lookup error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
  if (!config) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let webhookSecret: string;
  try {
    if (!config.webhook_secret_encrypted) throw new Error('missing secret');
    webhookSecret = decrypt(config.webhook_secret_encrypted);
  } catch {
    console.error('[email webhook] webhook_secret decrypt failed for', configId);
    return NextResponse.json({ error: 'Configuration error' }, { status: 500 });
  }

  const rawBody = await request.text();
  if (rawBody.length > 256 * 1024) {
    return NextResponse.json({ error: 'body too large' }, { status: 413 });
  }
  const verified = verifyResendWebhookSignature({
    secret: webhookSecret,
    svixId: request.headers.get('svix-id'),
    svixTimestamp: request.headers.get('svix-timestamp'),
    svixSignature: request.headers.get('svix-signature'),
    rawBody,
  });
  if (!verified) {
    console.warn('[email webhook] invalid signature for', configId);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const type = (body as { type?: unknown })?.type;

  // Delivery/lifecycle events (sent/delivered/bounced/…) are
  // handled by the T7.4 lifecycle handler in this same route.
  // Unknown types ack 200 so Resend does not retry them.
  if (type !== 'email.received') {
    after(async () => {
      try {
        const { handleResendLifecycleEvent } = await import('@/lib/email/lifecycle');
        await handleResendLifecycleEvent({
          db: supabaseAdmin(),
          accountId: config.account_id as string,
          payload: body as { type: string; data?: Record<string, unknown> },
        });
      } catch (err) {
        console.error('[email webhook] lifecycle handling failed:', err);
      }
    });
    return NextResponse.json({ status: 'received' }, { status: 200 });
  }

  const { data: account } = await supabaseAdmin()
    .from('accounts')
    .select('owner_user_id')
    .eq('id', config.account_id)
    .maybeSingle();
  const configOwnerUserId = (account as { owner_user_id: string } | null)?.owner_user_id;
  if (!configOwnerUserId) {
    console.error('[email webhook] no owner user_id for account', config.account_id);
    return NextResponse.json({ error: 'Configuration error' }, { status: 500 });
  }

  const normalized = normalizeResendInbound({
    payload: body as Parameters<typeof normalizeResendInbound>[0]['payload'],
    accountId: config.account_id as string,
    configOwnerUserId,
  });
  if (!normalized) {
    return NextResponse.json({ status: 'ignored' }, { status: 200 });
  }

  after(async () => {
    try {
      await processNormalizedInbound(normalized as NormalizedInbound);
    } catch (err) {
      console.error('[email webhook] processNormalizedInbound failed:', err);
    }
  });

  return NextResponse.json({ status: 'received' }, { status: 200 });
}
