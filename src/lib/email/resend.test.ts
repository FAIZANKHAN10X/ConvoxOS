import { afterEach, describe, expect, it, vi } from 'vitest';

import { sendResendEmail, verifyResendApiKey, ResendApiError } from './resend';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('verifyResendApiKey', () => {
  it('accepts a valid key via the domains read', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { data: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(verifyResendApiKey('re_test')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/domains',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer re_test' }),
      })
    );
  });

  it('maps auth failures to invalid_key without leaking', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(401, { message: 'Invalid API key' }))
    );
    const err = await verifyResendApiKey('bad').catch((e) => e);
    expect(err).toBeInstanceOf(ResendApiError);
    expect((err as ResendApiError).code).toBe('invalid_key');
    expect((err as ResendApiError).status).toBe(400);
  });

  it('marks rate limits and 5xx retryable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(429, { message: 'Too many requests' }))
    );
    const err = await verifyResendApiKey('k').catch((e) => e);
    expect((err as ResendApiError).retryable).toBe(true);
  });
});

describe('sendResendEmail', () => {
  it('sends with the idempotency header and returns the id', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { id: 'email-uuid-1' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await sendResendEmail('re_test', {
      from: 'Acme <hi@acme.test>',
      to: ['ann@example.com'],
      subject: 'Hello',
      text: 'Hi Ann',
      idempotencyKey: 'idem-1',
    });
    expect(result).toEqual({ id: 'email-uuid-1' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Idempotency-Key': 'idem-1' }),
      })
    );
  });

  it('validates recipients, subject, and body', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { id: 'x' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      sendResendEmail('k', { from: 'a@b.c', to: [], subject: 's', text: 't' })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      sendResendEmail('k', { from: 'a@b.c', to: ['x@y.z'], subject: ' ', text: 't' })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      sendResendEmail('k', { from: 'a@b.c', to: ['x@y.z'], subject: 's' })
    ).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
