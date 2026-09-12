import { afterEach, describe, expect, it, vi } from 'vitest';

import { encrypt } from '@/lib/crypto/encryption';

import { sendEmailToConversation, SendEmailError } from './send';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// Fake: conversations(+contact embed), email_config, messages.
function mockDb(opts: {
  contactEmail?: string | null;
  priorMessage?: Record<string, unknown> | null;
}) {
  const messages: Array<Record<string, unknown>> = [];
  const contact = {
    id: 'contact-1',
    email: opts.contactEmail === undefined ? 'ann@example.com' : opts.contactEmail,
    name: 'Ann',
  };
  return {
    messages,
    from(table: string) {
      if (!['messages', 'conversations', 'email_config'].includes(table)) {
        throw new Error(`unexpected ${table}`);
      }
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        insert: (payload: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              const row = { id: 'msg-1', ...payload };
              messages.push(row);
              return { data: row, error: null };
            },
          }),
        }),
        update: () => ({
          eq: async () => ({ error: null }),
        }),
        maybeSingle: async () => {
          if (table === 'messages') return { data: opts.priorMessage ?? null, error: null };
          if (table === 'conversations') {
            return {
              data: { id: 'conv-1', account_id: 'acct-1', contact },
              error: null,
            };
          }
          return {
            data: {
              id: 'cfg-1',
              api_key_encrypted: encrypt('re_secret'),
              from_address: 'sales@acme.test',
              from_name: 'Acme',
              status: 'connected',
            },
            error: null,
          };
        },
        single: async () => ({
          data: { id: 'conv-1', account_id: 'acct-1', contact },
          error: null,
        }),
      };
      return builder;
    },
  };
}

describe('sendEmailToConversation', () => {
  it('sends via Resend and persists with provenance', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { id: 'resend-uuid-1' }));
    vi.stubGlobal('fetch', fetchMock);
    const db = mockDb({});
    const result = await sendEmailToConversation(db as never, 'acct-1', {
      conversationId: 'conv-1',
      subject: 'Your quote',
      contentText: 'Hi Ann, here it is.',
      idempotencyKey: 'idem-1',
    });
    expect(result).toMatchObject({ messageId: 'msg-1', emailId: 'resend-uuid-1' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({ method: 'POST' })
    );
    expect(db.messages[0]).toMatchObject({
      channel: 'email',
      subject: 'Your quote',
      message_id: 'resend_resend-uuid-1',
      status: 'sent',
    });
  });

  it('reuses the persisted row on retry (no double send)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { id: 'resend-uuid-9' }));
    vi.stubGlobal('fetch', fetchMock);
    const db = mockDb({
      priorMessage: { id: 'msg-0', message_id: 'resend_resend-uuid-0' },
    });
    const result = await sendEmailToConversation(db as never, 'acct-1', {
      conversationId: 'conv-1',
      subject: 'Hi',
      contentText: 'Hello',
      idempotencyKey: 'idem-1',
    });
    expect(result.messageId).toBe('msg-0');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails cleanly without a contact email', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { id: 'x' }))
    );
    const db = mockDb({ contactEmail: null });
    const err = await sendEmailToConversation(db as never, 'acct-1', {
      conversationId: 'conv-1',
      subject: 'Hi',
      contentText: 'Hello',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SendEmailError);
    expect((err as SendEmailError).status).toBe(400);
  });
});
