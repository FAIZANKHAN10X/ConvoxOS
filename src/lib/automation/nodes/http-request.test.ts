import { beforeEach, describe, expect, it, vi } from 'vitest';

import { catalogFromRegistry } from '../catalog';
import { NodeExecutionError } from '../types';
import { defaultRegistry } from '../registry';
import { httpRequestAction } from './http-request';
import './index';

vi.mock('@/lib/http/safe-fetch', () => ({
  MAX_CAPTURED_BYTES: 32 * 1024,
  parseCapturedBody: (text: string) => {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  },
  SafeFetchError: class SafeFetchError extends Error {
    code: string;
    status?: number;
    retryable: boolean;
    body?: unknown;
    truncated?: boolean;
    constructor(
      code: 'ssrf_refused' | 'timeout' | 'network' | 'http_error',
      message: string,
      retryable: boolean,
      status?: number,
      extras?: { body?: unknown; truncated?: boolean }
    ) {
      super(message);
      this.name = 'SafeFetchError';
      this.code = code;
      this.retryable = retryable;
      this.status = status;
      this.body = extras?.body;
      this.truncated = extras?.truncated;
    }
  },
  safeFetch: vi.fn(),
}));

import { safeFetch, SafeFetchError } from '@/lib/http/safe-fetch';
import type { ExecutionContext } from '../types';

const mockedFetch = vi.mocked(safeFetch);

function ctx(vars: Record<string, unknown> = {}): ExecutionContext {
  return {
    accountId: 'a',
    contactId: 'c',
    runId: 'r',
    nodeId: 'n1',
    automationId: 'u',
    versionId: 'v',
    event: {
      id: 'e1',
      accountId: 'a',
      eventType: 'tag.added',
      contactId: 'c',
      payload: { tag_id: 't1' },
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
    db: {},
  };
}

function okResponse(status: number, body: string) {
  return { ok: true, status, text: async () => body } as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('action.http_request registry', () => {
  it('is registered with ports and catalog metadata', () => {
    const def = defaultRegistry.require('action.http_request');
    expect(def.kind).toBe('action');
    const entry = catalogFromRegistry(defaultRegistry).find(
      (n) => n.type === 'action.http_request'
    );
    expect(entry?.label).toBe('HTTP request');
    expect(entry?.ports.outgoing.map((h) => h.id)).toEqual(['default']);
  });

  it('summarizes as METHOD host', () => {
    expect(
      httpRequestAction.summarize?.({
        method: 'POST',
        url: 'https://n8n.test/webhook/abc',
        captureResponse: false,
        timeoutMs: 10000,
      })
    ).toBe('POST n8n.test');
  });

  it('rejects non-absolute and non-http URLs at validation', () => {
    expect(httpRequestAction.validate?.({ method: 'POST', url: 'nope', captureResponse: false, timeoutMs: 10000 }, { nodes: [], edges: [] })).toEqual([
      expect.stringContaining('absolute http(s) URL'),
    ]);
    expect(
      httpRequestAction.validate?.({ method: 'POST', url: 'ftp://x.test', captureResponse: false, timeoutMs: 10000 }, { nodes: [], edges: [] })
    ).toEqual(['URL must use http or https']);
    expect(
      httpRequestAction.validate?.({ method: 'POST', url: 'https://x.test', captureResponse: false, timeoutMs: 10000 }, { nodes: [], edges: [] })
    ).toEqual([]);
  });
});

describe('action.http_request execution', () => {
  it('omits the body on GET even if a template is configured', async () => {
    mockedFetch.mockResolvedValue(okResponse(200, ''));
    await httpRequestAction.execute?.(ctx(), {
      method: 'GET',
      url: 'https://n8n.test/hook',
      body: '{"should":"not-send"}',
      captureResponse: false,
      timeoutMs: 10000,
    });
    const [, opts] = mockedFetch.mock.calls[0];
    expect(opts).toMatchObject({ method: 'GET' });
    expect(opts?.body).toBeUndefined();
  });

  it('interpolates URL/headers/body and returns status', async () => {
    mockedFetch.mockResolvedValue(okResponse(200, '{"ok":true}'));
    const result = await httpRequestAction.execute?.(ctx({ name: 'Ada' }), {
      method: 'POST',
      url: 'https://n8n.test/hook/{{contactId}}',
      headers: [{ name: 'X-Name', value: '{{name}}' }],
      body: '{"to":"{{contactId}}"}',
      captureResponse: false,
      timeoutMs: 10000,
    });
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockedFetch.mock.calls[0];
    expect(url).toBe('https://n8n.test/hook/c');
    expect(opts).toMatchObject({
      method: 'POST',
      headers: { 'X-Name': 'Ada', 'Idempotency-Key': 'r:n1' },
      body: '{"to":"c"}',
      timeoutMs: 10000,
    });
    expect(result).toEqual({ status: 'ok', output: { status: 200 } });
  });

  it('captures and parses JSON responses with truncation flags', async () => {
    mockedFetch.mockResolvedValue(okResponse(201, '{"a":1}'));
    const result = await httpRequestAction.execute?.(ctx(), {
      method: 'POST',
      url: 'https://n8n.test/hook',
      captureResponse: true,
      timeoutMs: 10000,
    });
    expect(result).toEqual({
      status: 'ok',
      output: { status: 201, response: { status: 201, body: { a: 1 }, truncated: false } },
    });
  });

  it('fails non-retryably on invalid interpolated URLs', async () => {
    const result = await httpRequestAction.execute?.(ctx(), {
      method: 'POST',
      url: 'https://{{missing}}',
      captureResponse: false,
      timeoutMs: 10000,
    });
    // missing path renders empty, leaving an unparseable URL
    expect(mockedFetch).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'fail' });
  });

  it('maps SafeFetch verdicts onto engine retries', async () => {
    mockedFetch.mockRejectedValueOnce(
      new SafeFetchError('timeout', 'timed out', true)
    );
    await expect(
      httpRequestAction.execute?.(ctx(), {
        method: 'POST',
        url: 'https://n8n.test/hook',
        captureResponse: false,
        timeoutMs: 10000,
      })
    ).rejects.toBeInstanceOf(NodeExecutionError);

    mockedFetch.mockRejectedValueOnce(
      new SafeFetchError('http_error', 'bad', false, 400, {
        body: { error: 'nope' },
        truncated: false,
      })
    );
    await expect(
      httpRequestAction.execute?.(ctx(), {
        method: 'POST',
        url: 'https://n8n.test/hook',
        captureResponse: false,
        timeoutMs: 10000,
      })
    ).rejects.toMatchObject({
      retryable: false,
      details: {
        status: 400,
        response: { status: 400, body: { error: 'nope' }, truncated: false },
      },
    });
  });
});
