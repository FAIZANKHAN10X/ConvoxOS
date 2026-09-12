import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  processInbound: vi.fn(),
  afterCallbacks: [] as Array<() => Promise<void>>,
}));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    after: (cb: () => Promise<void>) => {
      mocks.afterCallbacks.push(cb);
    },
  };
});

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: mocks.admin,
}));

vi.mock('@/lib/inbound/processNormalizedInbound', () => ({
  processNormalizedInbound: mocks.processInbound,
}));

import { POST } from './route';

const SECRET = 'whsec_test_0123456789abcdef0123456789';
const CONFIG_ID = '11111111-1111-1111-1111-111111111111';
const SVIX_ID = 'msg_1';

function signedBody(body: string, ts: string, secret: string = SECRET): Record<string, string> {
  const sig = createHmac('sha256', secret)
    .update(`${SVIX_ID}.${ts}.${body}`, 'utf8')
    .digest('base64');
  return {
    'svix-id': SVIX_ID,
    'svix-timestamp': ts,
    'svix-signature': `v1,${sig}`,
  };
}

function dbWith(config: Record<string, unknown> | null) {
  return {
    from: (table: string) => {
      if (table === 'email_config') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: config, error: null }),
            }),
          }),
        };
      }
      if (table === 'accounts') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { owner_user_id: 'user-1' },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

const CONFIG = {
  id: CONFIG_ID,
  account_id: 'acct-1',
  webhook_secret_encrypted: 'ENC',
};

function request(body: string, headers: Record<string, string>) {
  return new Request(`http://localhost/api/email/webhook/${CONFIG_ID}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
}

const params = { params: Promise.resolve({ configId: CONFIG_ID }) };

// encrypt() is real — precompute by mocking? Instead mock the crypto module.
vi.mock('@/lib/crypto/encryption', () => ({
  decrypt: vi.fn(() => SECRET),
}));

describe('POST /api/email/webhook/[configId]', () => {
  beforeEach(() => {
    mocks.admin.mockReset();
    mocks.processInbound.mockReset();
    mocks.processInbound.mockResolvedValue(undefined);
    mocks.afterCallbacks.length = 0;
  });

  it('normalizes receipt into the CRM pipeline', async () => {
    mocks.admin.mockReturnValue(dbWith(CONFIG));
    const body = JSON.stringify({
      type: 'email.received',
      data: {
        email_id: 'in-1',
        from: 'ann@example.com',
        subject: 'Hi',
        text: 'Hello there',
      },
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const response = await POST(request(body, signedBody(body, ts)), params);
    expect(response.status).toBe(200);
    expect(mocks.afterCallbacks).toHaveLength(1);
    await mocks.afterCallbacks[0]();
    expect(mocks.processInbound).toHaveBeenCalledTimes(1);
    expect(mocks.processInbound).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'email', senderEmail: 'ann@example.com' })
    );
  });

  it('acks lifecycle types without CRM work', async () => {
    mocks.admin.mockReturnValue(dbWith(CONFIG));
    const body = JSON.stringify({ type: 'email.delivered', data: {} });
    const ts = String(Math.floor(Date.now() / 1000));
    const response = await POST(request(body, signedBody(body, ts)), params);
    expect(response.status).toBe(200);
    // Lifecycle runs in after(); the receipt pipeline stays untouched.
    expect(mocks.afterCallbacks).toHaveLength(1);
    await mocks.afterCallbacks[0]();
    expect(mocks.processInbound).not.toHaveBeenCalled();
  });

  it('rejects bad signatures, unknown configs, and bad ids', async () => {
    mocks.admin.mockReturnValue(dbWith(CONFIG));
    const body = JSON.stringify({ type: 'email.received', data: {} });
    const ts = String(Math.floor(Date.now() / 1000));
    const forged = await POST(
      request(body, signedBody(body, ts, 'wrong-secret')),
      params
    );
    expect(forged.status).toBe(401);

    mocks.admin.mockReturnValue(dbWith(null));
    const missing = await POST(request(body, signedBody(body, ts)), params);
    expect(missing.status).toBe(404);

    const badId = await POST(request(body, signedBody(body, ts)), {
      params: Promise.resolve({ configId: 'nope' }),
    });
    expect(badId.status).toBe(400);
  });
});
