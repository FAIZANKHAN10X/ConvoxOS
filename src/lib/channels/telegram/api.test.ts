import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getTelegramMe, setTelegramWebhook, deleteTelegramWebhook, TelegramApiError } from './api';

const origFetch = global.fetch;

function mockFetchOnce(json: Record<string, unknown>, status = 200) {
  global.fetch = vi.fn(async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
    }) as Response,
  );
}

describe('telegram api', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    global.fetch = origFetch;
  });

  it('getMe success', async () => {
    mockFetchOnce({ ok: true, result: { id: 12345, username: 'mybot', first_name: 'MyBot' } });
    const me = await getTelegramMe('123:abc');
    expect(me).toEqual({ id: 12345, username: 'mybot', firstName: 'MyBot' });
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/bot123:abc/getMe'), expect.anything());
  });

  it('getMe maps invalid token to invalid_token 400 without leaking raw desc', async () => {
    mockFetchOnce({ ok: false, description: 'Unauthorized: bot token invalid', error_code: 401 }, 401);
    await expect(getTelegramMe('bad:token')).rejects.toMatchObject({ code: 'invalid_token', status: 400 });
    try {
      await getTelegramMe('bad:token');
    } catch (e) {
      expect((e as TelegramApiError).message).not.toMatch(/Unauthorized: bot token invalid/);
      expect((e as TelegramApiError).message).toMatch(/Invalid bot token/);
    }
  });

  it('getMe network error maps to 502 retryable', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('fetch failed');
    });
    await expect(getTelegramMe('123:abc')).rejects.toMatchObject({ status: 502, retryable: true });
  });

  it('setWebhook posts url and secret_token', async () => {
    mockFetchOnce({ ok: true, result: true });
    await setTelegramWebhook({ botToken: '123:abc', url: 'https://example.com/api/telegram/webhook/uuid', secretToken: 'sec' });
    const url = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('/bot123:abc/setWebhook');
    const body = JSON.parse((global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string);
    expect(body.url).toBe('https://example.com/api/telegram/webhook/uuid');
    expect(body.secret_token).toBe('sec');
  });

  it('deleteWebhook calls deleteWebhook', async () => {
    mockFetchOnce({ ok: true, result: true });
    await deleteTelegramWebhook('123:abc');
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/deleteWebhook'), expect.anything());
  });

  it('malformed provider response throws', async () => {
    mockFetchOnce({ ok: true, result: { id: 'bad' } });
    await expect(getTelegramMe('123:abc')).rejects.toThrow(/invalid bot identity/);
  });

  it('rate limited maps to sanitized message', async () => {
    mockFetchOnce({ ok: false, description: 'Too Many Requests: retry after 30', error_code: 429 }, 429);
    await expect(getTelegramMe('123:abc')).rejects.toMatchObject({ code: 'rate_limited', retryable: true });
  });
});
