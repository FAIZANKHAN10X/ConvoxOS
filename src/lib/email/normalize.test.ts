import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { normalizeResendInbound, verifyResendWebhookSignature } from './normalize';

const SECRET = 'whsec_test_secret_0123456789abcdef';
const SVIX_ID = 'msg_1';
const SVIX_TS = String(Math.floor(Date.now() / 1000));
const BODY = JSON.stringify({ type: 'email.received', data: {} });

function sign(body: string): string {
  const sig = createHmac('sha256', SECRET)
    .update(`${SVIX_ID}.${SVIX_TS}.${body}`, 'utf8')
    .digest('base64');
  return `v1,${sig}`;
}

describe('verifyResendWebhookSignature', () => {
  it('accepts a valid Svix signature', () => {
    expect(
      verifyResendWebhookSignature({
        secret: SECRET,
        svixId: SVIX_ID,
        svixTimestamp: SVIX_TS,
        svixSignature: sign(BODY),
        rawBody: BODY,
      })
    ).toBe(true);
  });

  it('rejects tampered bodies, stale timestamps, and missing headers', () => {
    expect(
      verifyResendWebhookSignature({
        secret: SECRET,
        svixId: SVIX_ID,
        svixTimestamp: SVIX_TS,
        svixSignature: sign(BODY + 'x'),
        rawBody: BODY,
      })
    ).toBe(false);
    expect(
      verifyResendWebhookSignature({
        secret: SECRET,
        svixId: SVIX_ID,
        svixTimestamp: String(Math.floor(Date.now() / 1000) - 600),
        svixSignature: sign(BODY),
        rawBody: BODY,
      })
    ).toBe(false);
    expect(
      verifyResendWebhookSignature({
        secret: SECRET,
        svixId: null,
        svixTimestamp: SVIX_TS,
        svixSignature: sign(BODY),
        rawBody: BODY,
      })
    ).toBe(false);
  });
});

describe('normalizeResendInbound', () => {
  const received = {
    type: 'email.received',
    data: {
      email_id: 'inbound-uuid-1',
      from: 'Ann Lee <ann@example.com>',
      to: 'sales@acme.test',
      subject: 'Pricing question',
      text: 'How much for 10 seats?',
      headers: [
        { name: 'In-Reply-To', value: '<abc123@mail>' },
        { name: 'References', value: '<a@mail> <b@mail>' },
      ],
    },
  };

  it('maps receipt to NormalizedInbound', () => {
    const n = normalizeResendInbound({
      payload: received,
      accountId: 'acct-1',
      configOwnerUserId: 'user-1',
    });
    expect(n).toMatchObject({
      channel: 'email',
      accountId: 'acct-1',
      providerMessageId: 'resend_in_inbound-uuid-1',
      kind: 'text',
      text: 'How much for 10 seats?',
      senderEmail: 'ann@example.com',
      senderName: 'Ann Lee',
      emailSubject: 'Pricing question',
      emailInReplyTo: '<abc123@mail>',
      emailReferences: ['<a@mail>', '<b@mail>'],
    });
  });

  it('ignores non-receipt types and malformed payloads', () => {
    expect(
      normalizeResendInbound({
        payload: { type: 'email.delivered', data: {} },
        accountId: 'acct-1',
        configOwnerUserId: 'user-1',
      })
    ).toBeNull();
    expect(
      normalizeResendInbound({
        payload: { type: 'email.received', data: {} },
        accountId: 'acct-1',
        configOwnerUserId: 'user-1',
      })
    ).toBeNull();
  });
});
