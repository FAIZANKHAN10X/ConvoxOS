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

import {
  MAX_CAPTURED_BYTES,
  parseCapturedBody,
  safeFetch,
} from '@/lib/http/safe-fetch';
import { buildSignatureHeader } from '@/lib/webhooks/sign';

export { MAX_CAPTURED_BYTES, parseCapturedBody } from '@/lib/http/safe-fetch';

/** Stable across engine retries of the same run+node. */
export function outboundDeliveryId(ctx: {
  runId: string;
  nodeId?: string;
}): string {
  return `${ctx.runId}:${ctx.nodeId ?? 'node'}`;
}

export function withIdempotencyKey(
  headers: Record<string, string>,
  key: string
): Record<string, string> {
  const hasKey = Object.keys(headers).some(
    (name) => name.toLowerCase() === 'idempotency-key'
  );
  if (hasKey) return headers;
  return { ...headers, 'Idempotency-Key': key };
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
  /** When set, envelope `id` and Idempotency-Key stay stable across retries. */
  deliveryId?: string;
}): Promise<SignedPostResult> {
  const deliveryId = args.deliveryId ?? randomUUID();
  const rawBody = JSON.stringify({
    id: deliveryId,
    event: args.event,
    occurred_at: new Date().toISOString(),
    account_id: args.accountId,
    data: args.payload,
  });
  const tsSeconds = Math.floor(Date.now() / 1000);
  const res = await safeFetch(args.url, {
    method: 'POST',
    headers: withIdempotencyKey(
      {
        'Content-Type': 'application/json',
        'X-Wacrm-Event': args.event,
        'X-Wacrm-Signature': buildSignatureHeader(rawBody, args.secret, tsSeconds),
        ...args.extraHeaders,
      },
      deliveryId
    ),
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
