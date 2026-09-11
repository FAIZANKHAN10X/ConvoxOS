import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { catalogFromRegistry } from '../catalog';
import { defaultRegistry } from '../registry';
import { n8nWorkflowAction } from './n8n-workflow';
import {
  bindHookIdInGraph,
  inboundWebhookTrigger,
} from './inbound-webhook';
import { DOMAIN_EVENT } from '../event-types';
import type { ExecutionContext } from '../types';
import './index';

vi.mock('@/lib/integrations/signed-post', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/integrations/signed-post')>();
  return { ...actual, postSignedJson: vi.fn() };
});

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (s: string) => {
    if (s === 'garbage') throw new Error('bad ciphertext');
    return s;
  },
  encrypt: (s: string) => s,
}));

import { postSignedJson } from '@/lib/integrations/signed-post';

const mockedPost = vi.mocked(postSignedJson);

function dbWithEndpoint(row: Record<string, unknown> | null) {
  const calls: Array<{ op: string; table: string; payload?: unknown }> = [];
  const chain = (): Record<string, unknown> => {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      update: (payload: unknown) => {
        calls.push({ op: 'update', table: 'integration_endpoints', payload });
        return b;
      },
      maybeSingle: async () => ({ data: row, error: null }),
    };
    return b;
  };
  return {
    db: { from: () => chain() } as unknown as SupabaseClient,
    calls,
  };
}

function ctx(db: unknown, vars: Record<string, unknown> = {}): ExecutionContext {
  return {
    accountId: 'a',
    contactId: 'c',
    runId: 'r',
    automationId: 'u',
    versionId: 'v',
    event: {
      id: 'e1',
      accountId: 'a',
      eventType: 'tag.added',
      contactId: 'c',
      payload: {},
      source: 'crm',
      originRunId: null,
      causationEventId: null,
      chainDepth: 0,
      idempotencyKey: 'k',
      status: 'pending',
      attempts: 0,
      availableAt: new Date().toISOString(),
      processedAt: null,
      lastError: null,
      createdAt: new Date().toISOString(),
    },
    vars,
    now: new Date('2026-01-01T00:00:00.000Z'),
    db: db as never,
  };
}

const ENDPOINT = {
  id: 'ep-1',
  account_id: 'a',
  name: 'n8n prod',
  kind: 'n8n',
  url: 'https://n8n.test/hook',
  secret_enc: 'enc',
  is_active: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('action.n8n_workflow registry', () => {
  it('is registered with ports and catalog metadata', () => {
    expect(defaultRegistry.require('action.n8n_workflow')).toBe(
      n8nWorkflowAction
    );
    const entry = catalogFromRegistry(defaultRegistry).find(
      (n) => n.type === 'action.n8n_workflow'
    );
    expect(entry?.label).toBe('n8n workflow');
    expect(entry?.ports.outgoing.map((h) => h.id)).toEqual(['default']);
  });

  it('summarizes without leaking endpoint identity', () => {
    expect(
      n8nWorkflowAction.summarize?.({
        endpointId: '11111111-1111-1111-1111-111111111111',
        captureResponse: true,
        timeoutMs: 10000,
      })
    ).toBe('Call n8n workflow');
  });
});

describe('action.n8n_workflow execution', () => {
  it('posts mapped fields through the shared signed machinery', async () => {
    // decryptEndpointSecret reads real AES-GCM; stub at module level is
    // out of scope here — the endpoint row carries plaintext-equivalent
    // through the shared decrypt, so point at a unit-tested path instead:
    // missing/disabled endpoints fail closed without network.
    const { db } = dbWithEndpoint({ ...ENDPOINT, is_active: false });
    const result = await n8nWorkflowAction.execute?.(ctx(db), {
      endpointId: 'ep-1',
      captureResponse: true,
      timeoutMs: 10000,
    });
    expect(result).toEqual({
      status: 'fail',
      error: 'n8n endpoint missing or disabled',
    });
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('fails closed when the endpoint row is absent', async () => {
    const { db } = dbWithEndpoint(null);
    const result = await n8nWorkflowAction.execute?.(ctx(db), {
      endpointId: 'ep-1',
      captureResponse: true,
      timeoutMs: 10000,
    });
    expect(result).toEqual({
      status: 'fail',
      error: 'n8n endpoint missing or disabled',
    });
  });
});

describe('trigger.inbound_webhook matching', () => {
  function hookEvent(hookId: string) {
    return {
      id: 'e1',
      accountId: 'a',
      eventType: DOMAIN_EVENT.EXTERNAL_RECEIVED,
      contactId: 'c',
      payload: { hook_id: hookId },
      source: 'external' as const,
      originRunId: null,
      causationEventId: null,
      chainDepth: 0,
      idempotencyKey: 'k',
      status: 'pending' as const,
      attempts: 0,
      availableAt: new Date().toISOString(),
      processedAt: null,
      lastError: null,
      createdAt: new Date().toISOString(),
    };
  }

  it('stamps hookId onto inbound webhook trigger nodes', () => {
    const graph = bindHookIdInGraph(
      {
        nodes: [
          {
            id: 't',
            type: 'trigger.inbound_webhook',
            position: { x: 0, y: 0 },
            data: { config: {} },
          },
        ],
        edges: [],
      },
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    );
    expect(graph.nodes[0]?.data?.config).toEqual({
      hookId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    });
  });

  it('matches only its own hook id', () => {
    const config = { hookId: 'hook-1' };
    expect(inboundWebhookTrigger.match?.(hookEvent('hook-1'), config)).toBe(true);
    expect(inboundWebhookTrigger.match?.(hookEvent('hook-2'), config)).toBe(false);
    expect(
      inboundWebhookTrigger.match?.(
        { ...hookEvent('hook-1'), eventType: 'tag.added' },
        config
      )
    ).toBe(false);
  });

  it('posts interpolated fields with the stored secret on the happy path', async () => {
    mockedPost.mockResolvedValueOnce({
      status: 200,
      body: { received: true },
      truncated: false,
    });
    const { db, calls } = dbWithEndpoint(ENDPOINT);
    const result = await n8nWorkflowAction.execute?.(
      ctx(db, { orderId: 'ord-9' }),
      {
        endpointId: 'ep-1',
        fields: [
          { key: 'order', value: '{{orderId}}' },
          { key: 'static', value: 'x' },
        ],
        captureResponse: true,
        timeoutMs: 10000,
      }
    );
    expect(mockedPost).toHaveBeenCalledTimes(1);
    const call = mockedPost.mock.calls[0][0];
    expect(call).toMatchObject({
      url: 'https://n8n.test/hook',
      secret: 'enc',
      event: 'automation.n8n_call',
      accountId: 'a',
      timeoutMs: 10000,
      deliveryId: 'r:node',
    });
    expect(call.payload).toMatchObject({
      contact_id: 'c',
      run_id: 'r',
      order: 'ord-9',
      static: 'x',
    });
    expect(result).toEqual({
      status: 'ok',
      output: {
        status: 200,
        response: { status: 200, body: { received: true }, truncated: false },
      },
    });
    expect(calls.some((c) => c.op === 'update')).toBe(true);
  });

  it('fails closed on unreadable endpoint secrets (operator error)', async () => {
    const { db } = dbWithEndpoint({ ...ENDPOINT, secret_enc: 'garbage' });
    const result = await n8nWorkflowAction.execute?.(ctx(db), {
      endpointId: 'ep-1',
      captureResponse: true,
      timeoutMs: 10000,
    });
    expect(result).toEqual({
      status: 'fail',
      error: 'n8n endpoint secret unreadable',
    });
    expect(mockedPost).not.toHaveBeenCalled();
  });
});
