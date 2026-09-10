// ============================================================
// Signed JSON POST shared by integration executors.
//
// Same envelope + signature scheme as outbound webhooks so every
// external receiver (n8n Code node, middleware, scripts) verifies
// deliveries one way: `X-Wacrm-Signature: t=…,v1=HMAC(secret,
// "${t}.${rawBody}")`. Transport goes through safe-fetch (SSRF
// guard, no redirects, timeout); verdicts map onto engine retries
// at the call site.
// ============================================================

import { randomUUID } from 'node:crypto';

import { safeFetch } from '@/lib/http/safe-fetch';
import { buildSignatureHeader } from '@/lib/webhooks/sign';

/** Truncate stored response bodies so one chatty sink can't bloat runs. */
export const MAX_CAPTURED_BYTES = 32 * 1024;

export function parseCapturedBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export interface SignedPostResult {
  status: number;
  body: unknown;
  truncated: boolean;
}

export async function postSignedJson(args: {
  url: string;
  secret: string;
  payload: Record<string, unknown>;
  event: string;
  accountId: string;
  timeoutMs: number;
  extraHeaders?: Record<string, string>;
}): Promise<SignedPostResult> {
  const rawBody = JSON.stringify({
    id: randomUUID(),
    event: args.event,
    occurred_at: new Date().toISOString(),
    account_id: args.accountId,
    data: args.payload,
  });
  const tsSeconds = Math.floor(Date.now() / 1000);
  const res = await safeFetch(args.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Wacrm-Event': args.event,
      'X-Wacrm-Signature': buildSignatureHeader(rawBody, args.secret, tsSeconds),
      ...args.extraHeaders,
    },
    body: rawBody,
    timeoutMs: args.timeoutMs,
  });
  const text = await res.text();
  return {
    status: res.status,
    body: parseCapturedBody(text.slice(0, MAX_CAPTURED_BYTES)),
    truncated: text.length > MAX_CAPTURED_BYTES,
  };
}
