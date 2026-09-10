import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/webhooks/ssrf', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/webhooks/ssrf')>();
  return { ...actual, isDeliverableUrl: vi.fn(actual.isDeliverableUrl) };
});

import { isDeliverableUrl } from '@/lib/webhooks/ssrf';

import {
  createIntegrationEndpoint,
  decryptEndpointSecret,
  generateIntegrationSecret,
  getIntegrationEndpoint,
  INTEGRATION_SECRET_PREFIX,
} from './endpoints';
import { MAX_CAPTURED_BYTES, postSignedJson } from './signed-post';
import { buildSignatureHeader } from '@/lib/webhooks/sign';

function makeDb(row: Record<string, unknown> | null = null) {
  const calls: Array<{ op: string; table: string; payload?: unknown }> = [];
  const chain = (table: string): Record<string, unknown> => {
    const b: Record<string, unknown> = {
      select: () => b,
      insert: (payload: unknown) => {
        calls.push({ op: 'insert', table, payload });
        return b;
      },
      eq: () => b,
      maybeSingle: async () => ({ data: row, error: null }),
      single: async () => ({ data: { id: 'ep-1' }, error: null }),
    };
    return b;
  };
  return {
    db: { from: (t: string) => chain(t) } as unknown as SupabaseClient,
    calls,
  };
}

describe('integration endpoints', () => {
  it('generates prefixed secrets and stores encrypted copies only', async () => {
    expect(generateIntegrationSecret().startsWith(INTEGRATION_SECRET_PREFIX)).toBe(true);
    const { db, calls } = makeDb();
    const created = await createIntegrationEndpoint(db, {
      accountId: 'acct-1',
      createdBy: 'user-1',
      name: 'n8n prod',
      kind: 'n8n',
      url: 'https://n8n.test/hook',
    });
    expect(created.secret.startsWith(INTEGRATION_SECRET_PREFIX)).toBe(true);
    const insert = calls.find((c) => c.op === 'insert');
    const payload = insert?.payload as Record<string, unknown>;
    expect(payload.secret_enc).not.toContain(created.secret);
    expect(payload).toMatchObject({
      account_id: 'acct-1',
      name: 'n8n prod',
      kind: 'n8n',
      url: 'https://n8n.test/hook',
    });
  });

  it('reads rows back and decrypt delegates to AES-GCM', async () => {
    const row = {
      id: 'ep-1',
      account_id: 'acct-1',
      name: 'n',
      kind: 'n8n',
      url: 'https://n8n.test/hook',
      secret_enc: 'enc',
      is_active: true,
    };
    const { db } = makeDb(row);
    expect(
      await getIntegrationEndpoint(db, { accountId: 'acct-1', endpointId: 'ep-1' })
    ).toEqual(row);
    expect(() => decryptEndpointSecret('not-encrypted')).toThrow();
  });
});

describe('postSignedJson', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.mocked(isDeliverableUrl).mockResolvedValue(true);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('signs the exact bytes and returns parsed bodies', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: async () => '{"ok":true}' } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const result = await postSignedJson({
      url: 'https://n8n.test/hook',
      secret: 's3cret',
      payload: { a: 1 },
      event: 'automation.n8n_call',
      accountId: 'acct-1',
      timeoutMs: 5000,
    });
    expect(result).toEqual({
      status: 200,
      body: { ok: true },
      truncated: false,
    });
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://n8n.test/hook');
    expect(opts.method).toBe('POST');
    expect(opts.headers['X-Wacrm-Event']).toBe('automation.n8n_call');
    expect(opts.headers['X-Wacrm-Signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    // The signature verifies against the exact sent bytes.
    const sent: string = opts.body;
    const header: string = opts.headers['X-Wacrm-Signature'];
    const ts = Math.floor(Date.now() / 1000);
    expect(
      (await import('@/lib/webhooks/sign')).verifySignatureHeader(
        header,
        sent,
        's3cret',
        ts,
        3600
      )
    ).toBe(true);
    expect(JSON.parse(sent).account_id).toBe('acct-1');
    expect(buildSignatureHeader).toBeDefined();
  });

  it('flags truncated bodies', async () => {
    const big = 'x'.repeat(MAX_CAPTURED_BYTES + 10);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => big } as Response)
    );
    const result = await postSignedJson({
      url: 'https://n8n.test/hook',
      secret: 's',
      payload: {},
      event: 'e',
      accountId: 'a',
      timeoutMs: 5000,
    });
    expect(result.truncated).toBe(true);
    expect(result.body).toBe(big.slice(0, MAX_CAPTURED_BYTES));
  });
});
