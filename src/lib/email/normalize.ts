import { createHmac, timingSafeEqual } from 'node:crypto';

import type { NormalizedInbound } from '@/lib/channels/types';

/**
 * Resend posts Svix-signed webhooks: `svix-id`, `svix-timestamp`,
 * `svix-signature: v1,<base64 hmac-sha256(id.timestamp.body)>`.
 * Verified manually (no svix dependency) against the per-config
 * secret — same fail-closed posture as the telegram webhook.
 */
export function verifyResendWebhookSignature(opts: {
  secret: string;
  svixId: string | null;
  svixTimestamp: string | null;
  svixSignature: string | null;
  rawBody: string;
  nowSeconds?: number;
}): boolean {
  const { secret, svixId, svixTimestamp, svixSignature, rawBody } = opts;
  if (!svixId || !svixTimestamp || !svixSignature) return false;
  // 5-minute replay tolerance, mirroring the hooks route.
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ts = Number(svixTimestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) return false;
  const versions = svixSignature.split(' ').map((p) => p.split(','));
  const expected = createHmac('sha256', secret)
    .update(`${svixId}.${svixTimestamp}.${rawBody}`, 'utf8')
    .digest('base64');
  const expectedBuf = Buffer.from(expected);
  for (const [version, sig] of versions) {
    if (version !== 'v1' || !sig) continue;
    const sigBuf = Buffer.from(sig);
    if (sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf)) {
      return true;
    }
  }
  return false;
}

export interface ResendInboundPayload {
  type?: unknown;
  data?: {
    email_id?: unknown;
    message_id?: unknown;
    from?: unknown;
    to?: unknown;
    subject?: unknown;
    text?: unknown;
    html?: unknown;
    headers?: unknown;
    created_at?: unknown;
  };
}

function bareAddress(value: string): string | null {
  const angled = value.match(/<([^<>]+)>/);
  const candidate = (angled ? angled[1] : value).trim();
  return candidate.includes('@') ? candidate : null;
}

function firstAddress(value: unknown): string | null {
  if (typeof value === 'string') return bareAddress(value);
  if (Array.isArray(value)) {
    for (const v of value) {
      const s = firstAddress(v);
      if (s) return s;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    const email = (value as Record<string, unknown>).email;
    if (typeof email === 'string') return bareAddress(email);
  }
  return null;
}

function headerValue(headers: unknown, name: string): string | null {
  if (!headers) return null;
  if (Array.isArray(headers)) {
    for (const h of headers) {
      if (h && typeof h === 'object') {
        const rec = h as Record<string, unknown>;
        if (typeof rec.name === 'string' && rec.name.toLowerCase() === name) {
          return typeof rec.value === 'string' ? rec.value : null;
        }
      }
    }
    return null;
  }
  if (typeof headers === 'object') {
    const rec = headers as Record<string, unknown>;
    const v = rec[name] ?? rec[name.toLowerCase()];
    return typeof v === 'string' ? v : null;
  }
  return null;
}

function displayName(address: string): string {
  const angled = address.indexOf('<');
  if (angled >= 0) {
    const name = address.slice(0, angled).trim().replace(/^"|"$/g, '').trim();
    if (name) return name;
  }
  const bare = address.split('@')[0].replace(/[._-]+/g, ' ').trim();
  return bare || address;
}

/**
 * Resend `email.received` → NormalizedInbound. Pure mapping, no DB.
 * providerMessageId is the Resend inbound email id (globally unique).
 * Threading headers pass through for reply association; the CRM
 * pipeline resolves them against stored provider ids.
 */
export function normalizeResendInbound(opts: {
  payload: ResendInboundPayload;
  accountId: string;
  configOwnerUserId: string;
}): NormalizedInbound | null {
  const { payload, accountId, configOwnerUserId } = opts;
  if (payload.type !== 'email.received') return null;
  const data = payload.data ?? {};
  const emailId =
    typeof data.email_id === 'string'
      ? data.email_id
      : typeof data.message_id === 'string'
        ? data.message_id
        : null;
  if (!emailId) return null;
  const rawFrom =
    typeof data.from === 'string'
      ? data.from
      : Array.isArray(data.from)
        ? data.from.find((v): v is string => typeof v === 'string')
        : null;
  const from = firstAddress(data.from);
  if (!from) return null;

  const subject =
    typeof data.subject === 'string' && data.subject.trim()
      ? data.subject.trim().slice(0, 500)
      : null;
  const text =
    typeof data.text === 'string' && data.text.trim() ? data.text.trim() : null;
  const senderEmail = from.trim().toLowerCase();
  return {
    channel: 'email',
    accountId,
    configOwnerUserId,
    providerMessageId: `resend_in_${emailId}`,
    kind: 'text',
    text: text ?? subject ?? '[email]',
    senderEmail,
    senderName: displayName(rawFrom ?? from),
    emailSubject: subject,
    emailMessageId: emailId,
    emailInReplyTo: headerValue(data.headers, 'in-reply-to'),
    emailReferences: (() => {
      const refs = headerValue(data.headers, 'references');
      return refs ? refs.split(/\s+/).filter(Boolean).slice(0, 20) : null;
    })(),
    raw: payload,
  };
}
