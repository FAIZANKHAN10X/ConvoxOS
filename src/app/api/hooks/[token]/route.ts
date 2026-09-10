// ============================================================
// POST /api/hooks/[token] — inbound automation webhooks.
//
// An external system (n8n, middleware, scripts) fires a native
// automation by POSTing JSON here. Auth is two-part, mirroring the
// outbound webhook scheme in reverse:
//   1. The bearer `token` in the path identifies the hook row
//      (SHA-256 lookup — unknown/inactive tokens 404 alike, so a
//      scanner learns nothing).
//   2. `X-Wacrm-Signature: t=…,v1=…` must verify over the exact raw
//      body with the hook's HMAC secret (300s replay tolerance).
//
// A valid delivery becomes a domain event (`external.received`,
// source `external`) and enters the standard worker pipeline —
// matching, runs, waits, and history work exactly as for CRM
// events. Contact resolution is lookup-only: `contact_id` (must
// belong to the account) else `phone`, else contactless (logged,
// no run — runs are contact-scoped).
// ============================================================

import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';

import { DOMAIN_EVENT } from '@/lib/automation/event-types';
import { enqueueDomainEventWithClient } from '@/lib/automation/events';
import { kickDomainEvent } from '@/lib/automation/kick';
import {
  decryptHookSecret,
  findHookByTokenHash,
  hashHookToken,
  touchHookReceived,
} from '@/lib/integrations/hooks';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { verifySignatureHeader } from '@/lib/webhooks/sign';

/** Reject outsized deliveries before parsing. */
export const MAX_HOOK_BODY_BYTES = 256 * 1024;

function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

function notFound(): NextResponse {
  return NextResponse.json({ error: 'not found' }, { status: 404 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
): Promise<NextResponse> {
  const { token } = await params;
  if (!token || token.length < 16) return notFound();

  const limited = checkRateLimit(`hooks:${token.slice(0, 12)}`, RATE_LIMITS.publicApi);
  if (!limited.success) return rateLimitResponse(limited);

  const db = supabaseAdmin();
  const hook = await findHookByTokenHash(db, hashHookToken(token));
  if (!hook || !hook.is_active) return notFound();

  let secret: string;
  try {
    secret = decryptHookSecret(hook.secret_enc);
  } catch {
    return notFound();
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_HOOK_BODY_BYTES) {
    return NextResponse.json({ error: 'body too large' }, { status: 413 });
  }
  const signature = request.headers.get('X-Wacrm-Signature') ?? '';
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!verifySignatureHeader(signature, rawBody, secret, nowSeconds)) {
    return unauthorized();
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = rawBody ? JSON.parse(rawBody) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'body must be a JSON object' }, { status: 400 });
  }

  const contactId = await resolveContact(db, hook.account_id, body);

  const deliveryId = request.headers.get('X-Wacrm-Delivery-Id');
  const event = await enqueueDomainEventWithClient(db, {
    accountId: hook.account_id,
    eventType: DOMAIN_EVENT.EXTERNAL_RECEIVED,
    contactId,
    payload: { hook_id: hook.id, automation_id: hook.automation_id, body },
    source: 'external',
    idempotencyKey:
      deliveryId && deliveryId.length > 0 && deliveryId.length <= 128
        ? `hook:${hook.id}:${deliveryId}`
        : `hook:${hook.id}:${randomUUID()}`,
  });
  await touchHookReceived(db, hook.id);
  kickDomainEvent(event.id);

  return NextResponse.json(
    { event_id: event.id, contact_id: contactId },
    { status: 202 }
  );
}

/**
 * Lookup-only contact resolution. Never creates contacts from
 * external input — an unknown identity yields a contactless event
 * (audited, but no run; runs are contact-scoped).
 */
async function resolveContact(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  body: Record<string, unknown>
): Promise<string | null> {
  const id = body.contact_id;
  if (typeof id === 'string' && id) {
    const { data } = await db
      .from('contacts')
      .select('id')
      .eq('account_id', accountId)
      .eq('id', id)
      .maybeSingle();
    const row = data as { id: string } | null;
    if (row) return row.id;
  }
  const phone = body.phone;
  if (typeof phone === 'string' && phone) {
    const { data } = await db
      .from('contacts')
      .select('id')
      .eq('account_id', accountId)
      .eq('phone', phone)
      .maybeSingle();
    const row = data as { id: string } | null;
    if (row) return row.id;
  }
  return null;
}
