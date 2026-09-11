import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({
  hookRow: null as Record<string, unknown> | null,
  contactRow: null as Record<string, unknown> | null,
  inserted: [] as Array<Record<string, unknown>>,
  kicked: [] as string[],
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => mockDb(),
}));

vi.mock('@/lib/automation/kick', () => ({
  kickDomainEvent: (id: string) => {
    mocks.kicked.push(id);
  },
}));

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (s: string) => s,
  encrypt: (s: string) => s,
}));

import { buildSignatureHeader } from '@/lib/webhooks/sign';
import { hashHookToken } from '@/lib/integrations/hooks';

import { POST } from './route';

function mockDb() {
  const chain = (table: string): Record<string, unknown> => {
    const state: { update?: unknown; id?: string } = {};
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (payload: unknown) => {
        mocks.inserted.push({
          table,
          ...(payload as Record<string, unknown>),
        });
        return b;
      },
      update: (payload: unknown) => {
        state.update = payload;
        return b;
      },
      eq: (col: string, val: unknown) => {
        if (col === 'id') state.id = String(val);
        return b;
      },
      maybeSingle: async () => {
        if (table === 'automation_inbound_hooks') {
          return { data: mocks.hookRow, error: null };
        }
        if (table === 'contacts') {
          return { data: mocks.contactRow, error: null };
        }
        if (table === 'domain_events') {
          const last = mocks.inserted[mocks.inserted.length - 1] ?? {};
          return {
            data: {
              id: 'evt-1',
              account_id: last.account_id ?? 'acct-1',
              event_type: last.event_type ?? 'external.received',
              contact_id: last.contact_id ?? null,
              payload: last.payload ?? {},
              source: 'external',
              origin_run_id: null,
              causation_event_id: null,
              chain_depth: 0,
              idempotency_key: last.idempotency_key ?? 'k',
              status: 'pending',
              attempts: 0,
              available_at: new Date().toISOString(),
              processed_at: null,
              last_error: null,
              created_at: new Date().toISOString(),
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
    };
    return b;
  };
  return { from: (table: string) => chain(table) } as unknown as SupabaseClient;
}

const HOOK = {
  id: 'hook-1',
  account_id: 'acct-1',
  automation_id: 'auto-1',
  secret_enc: 's3cret',
  is_active: true,
};
const CONTACT = { id: 'contact-1' };
const TOKEN = 'whk_test_token_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function signedRequest(
  token: string,
  body: unknown,
  secret = 's3cret',
  ts?: number,
  extraHeaders: Record<string, string> = {}
) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const t = ts ?? Math.floor(Date.now() / 1000);
  return new Request(`http://localhost/api/hooks/${token}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Wacrm-Signature': buildSignatureHeader(raw, secret, t),
      ...extraHeaders,
    },
    body: raw,
  });
}

beforeEach(() => {
  mocks.hookRow = { ...HOOK };
  mocks.contactRow = { ...CONTACT };
  mocks.inserted.length = 0;
  mocks.kicked.length = 0;
});

describe('POST /api/hooks/[token]', () => {
  it('404s unknown and inactive hooks alike', async () => {
    mocks.hookRow = null;
    const missing = await POST(signedRequest('whk_nope', {}), {
      params: Promise.resolve({ token: 'whk_nope' }),
    });
    expect(missing.status).toBe(404);

    mocks.hookRow = { ...HOOK, is_active: false };
    const inactive = await POST(signedRequest(TOKEN, {}), {
      params: Promise.resolve({ token: TOKEN }),
    });
    expect(inactive.status).toBe(404);
    expect(mocks.inserted).toHaveLength(0);
  });

  it('401s bad signatures and stale timestamps', async () => {
    const badSig = await POST(signedRequest(TOKEN, {}, 'wrong-secret'), {
      params: Promise.resolve({ token: TOKEN }),
    });
    expect(badSig.status).toBe(401);

    const stale = await POST(
      signedRequest(TOKEN, {}, 's3cret', Math.floor(Date.now() / 1000) - 900),
      { params: Promise.resolve({ token: TOKEN }) }
    );
    expect(stale.status).toBe(401);

    const unsigned = await POST(
      new Request(`http://localhost/api/hooks/${TOKEN}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }),
      { params: Promise.resolve({ token: TOKEN }) }
    );
    expect(unsigned.status).toBe(401);
    expect(mocks.inserted).toHaveLength(0);
  });

  it('400s non-object bodies and 413s oversized ones', async () => {
    const notObject = await POST(signedRequest(TOKEN, [1, 2]), {
      params: Promise.resolve({ token: TOKEN }),
    });
    expect(notObject.status).toBe(400);

    const big = await POST(signedRequest(TOKEN, { pad: 'x'.repeat(300 * 1024) }), {
      params: Promise.resolve({ token: TOKEN }),
    });
    expect(big.status).toBe(413);
    expect(mocks.inserted).toHaveLength(0);
  });

  it('enqueues a scoped event and kicks the worker for known contacts', async () => {
    const res = await POST(
      signedRequest(
        TOKEN,
        { contact_id: 'contact-1', order: 7 },
        's3cret',
        undefined,
        { 'X-Wacrm-Delivery-Id': 'n8n-1' }
      ),
      { params: Promise.resolve({ token: TOKEN }) }
    );
    expect(res.status).toBe(202);
    expect(mocks.inserted).toHaveLength(1);
    const row = mocks.inserted[0];
    expect(row).toMatchObject({
      table: 'domain_events',
      account_id: 'acct-1',
      event_type: 'external.received',
      source: 'external',
      contact_id: 'contact-1',
      idempotency_key: 'hook:hook-1:n8n-1',
    });
    expect(row.payload).toMatchObject({
      hook_id: 'hook-1',
      automation_id: 'auto-1',
    });
    expect(mocks.kicked).toEqual(['evt-1']);
    await expect(res.json()).resolves.toMatchObject({
      event_id: 'evt-1',
      contact_id: 'contact-1',
    });
  });

  it('accepts contactless deliveries without a run target', async () => {
    mocks.contactRow = null;
    const res = await POST(signedRequest(TOKEN, { ping: true }), {
      params: Promise.resolve({ token: TOKEN }),
    });
    expect(res.status).toBe(202);
    await expect(res.json()).resolves.toMatchObject({ contact_id: null });
    expect(mocks.inserted[0].contact_id).toBeNull();
  });

  it('ignores contact ids from other accounts', async () => {
    // findHookByTokenHash is account-scoped by row; the contact check
    // filters by the hook's account, so a foreign id resolves to null.
    mocks.contactRow = null;
    const res = await POST(signedRequest(TOKEN, { contact_id: 'foreign' }), {
      params: Promise.resolve({ token: TOKEN }),
    });
    expect(res.status).toBe(202);
    await expect(res.json()).resolves.toMatchObject({ contact_id: null });
  });

  it('hashes tokens the same way creation does', () => {
    expect(hashHookToken(TOKEN)).toMatch(/^[0-9a-f]{64}$/);
  });
});
