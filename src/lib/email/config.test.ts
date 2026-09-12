import { afterEach, describe, expect, it, vi } from 'vitest';

import { encrypt } from '@/lib/crypto/encryption';

import { connectEmail, disconnectEmail, getEmailApiKey } from './config';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// Minimal email_config fake: select/upsert/delete.
function mockDb(existing: Record<string, unknown> | null = null) {
  const state = { row: existing };
  return {
    state,
    from(table: string) {
      if (table !== 'email_config') throw new Error(`unexpected ${table}`);
      const eqs: Array<{ col: string; val: unknown }> = [];
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          eqs.push({ col, val });
          return builder;
        },
        upsert: (payload: Record<string, unknown>) => ({
          select: () => ({
            single: async () => ({
              data: { id: 'cfg-1', ...payload },
              error: null,
            }),
          }),
        }),
        delete: () => ({
          eq: async () => {
            state.row = null;
            return { error: null };
          },
        }),
        maybeSingle: async () => ({ data: state.row, error: null }),
      };
      return builder;
    },
  };
}

describe('connectEmail', () => {
  it('validates the key, encrypts, and returns webhook material', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        expect(url).toBe('https://api.resend.com/domains');
        return jsonResponse(200, { data: [] });
      })
    );
    const db = mockDb();
    const result = await connectEmail(db as never, {
      accountId: 'acct-1',
      userId: 'user-1',
      apiKey: 're_valid',
      fromAddress: 'sales@acme.test',
      fromName: 'Acme',
      appOrigin: 'https://app.test',
    });
    expect(result.config.from_address).toBe('sales@acme.test');
    expect(result.webhookUrl).toBe(
      'https://app.test/api/email/webhook/cfg-1'
    );
    expect(result.webhookSecret.length).toBeGreaterThan(16);
  });

  it('surfaces invalid keys and addresses as 400s', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(401, { message: 'Invalid API key' }))
    );
    const db = mockDb();
    await expect(
      connectEmail(db as never, {
        accountId: 'acct-1',
        userId: 'user-1',
        apiKey: 're_bad',
        fromAddress: 'sales@acme.test',
        appOrigin: 'https://app.test',
      })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      connectEmail(db as never, {
        accountId: 'acct-1',
        userId: 'user-1',
        apiKey: 're_valid',
        fromAddress: 'not-an-email',
        appOrigin: 'https://app.test',
      })
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('getEmailApiKey', () => {
  it('decrypts the key and formats the sender', async () => {
    const db = mockDb({
      id: 'cfg-1',
      api_key_encrypted: encrypt('re_secret'),
      from_address: 'sales@acme.test',
      from_name: 'Acme',
      status: 'connected',
    });
    const result = await getEmailApiKey(db as never, 'acct-1');
    expect(result).toMatchObject({
      apiKey: 're_secret',
      from: 'Acme <sales@acme.test>',
      replyTo: 'sales@acme.test',
    });
  });

  it('fails closed when missing or disconnected', async () => {
    await expect(getEmailApiKey(mockDb(null) as never, 'acct-1')).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      getEmailApiKey(
        mockDb({
          id: 'cfg-1',
          api_key_encrypted: encrypt('x'),
          from_address: 'a@b.c',
          from_name: null,
          status: 'disconnected',
        }) as never,
        'acct-1'
      )
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('disconnectEmail', () => {
  it('deletes the config row', async () => {
    const db = mockDb({ id: 'cfg-1' });
    await disconnectEmail(db as never, 'acct-1');
    expect(db.state.row).toBeNull();
  });
});
