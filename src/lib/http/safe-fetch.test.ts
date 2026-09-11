// ============================================================
// safe-fetch: shared outbound HTTP policy. Proves the SSRF /
// redirect / timeout / retry-verdict contract every integration
// node inherits — without touching the network.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/webhooks/ssrf', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/webhooks/ssrf')>();
  return { ...actual, isDeliverableUrl: vi.fn(actual.isDeliverableUrl) };
});

import {
  safeFetch,
  SAFE_FETCH_DEFAULT_TIMEOUT_MS,
} from './safe-fetch';
import { isDeliverableUrl } from '@/lib/webhooks/ssrf';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe('safeFetch', () => {
  it('refuses loopback, private, and malformed URLs without fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const url of [
      'http://127.0.0.1/hook',
      'http://localhost/hook',
      'http://10.0.0.5/hook',
      'http://169.254.169.254/latest',
      'not-a-url',
      '',
    ]) {
      await expect(safeFetch(url)).rejects.toMatchObject({
        name: 'SafeFetchError',
        code: 'ssrf_refused',
        retryable: false,
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs with manual redirect and a timeout signal', async () => {
    vi.mocked(isDeliverableUrl).mockResolvedValue(true);
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200 } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const res = await safeFetch('https://a.test/hook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"x":1}',
      timeoutMs: 1234,
    });

    expect(res.ok).toBe(true);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://a.test/hook');
    expect(opts.method).toBe('POST');
    expect(opts.redirect).toBe('manual');
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('uses the default timeout budget', () => {
    expect(SAFE_FETCH_DEFAULT_TIMEOUT_MS).toBe(5000);
  });

  it('marks 5xx/429/timeout as retryable, 4xx as not', async () => {
    vi.mocked(isDeliverableUrl).mockResolvedValue(true);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => '',
    } as Response);
    await expect(safeFetch('https://a.test/hook')).rejects.toMatchObject({
      code: 'http_error',
      status: 503,
      retryable: true,
    });

    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => '',
    } as Response);
    await expect(safeFetch('https://a.test/hook')).rejects.toMatchObject({
      retryable: true,
    });

    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"error":"nope"}',
    } as Response);
    await expect(safeFetch('https://a.test/hook')).rejects.toMatchObject({
      code: 'http_error',
      status: 400,
      retryable: false,
      body: { error: 'nope' },
      truncated: false,
    });

    fetchMock.mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'TimeoutError' })
    );
    await expect(safeFetch('https://a.test/hook')).rejects.toMatchObject({
      code: 'timeout',
      retryable: true,
    });

    fetchMock.mockRejectedValue(new Error('boom'));
    await expect(safeFetch('https://a.test/hook')).rejects.toMatchObject({
      code: 'network',
      retryable: true,
    });
  });
});
