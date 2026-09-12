import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  find: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: mocks.admin,
}));

vi.mock('@/lib/forms/write', () => ({
  hashFormToken: (t: string) => `hash:${t}`,
  findFormByTokenHash: mocks.find,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () =>
    Response.json({ error: 'rate limited' }, { status: 429 }),
  RATE_LIMITS: { publicApi: {} },
}));

import { GET } from './route';

const FORM = {
  id: 'form-1',
  account_id: 'account-1',
  name: 'Landing',
  fields: [{ key: 'phone', label: 'Phone', type: 'phone', required: true }],
  is_active: true,
};

const params = { params: Promise.resolve({ token: 'TOKEN12345678901' }) };

describe('GET /api/forms/[token]', () => {
  it('peeks the display schema of active forms', async () => {
    mocks.admin.mockReturnValue({});
    mocks.find.mockResolvedValue(FORM);
    const response = await GET(
      new Request('http://localhost/api/forms/TOKEN12345678901'),
      params
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      name: 'Landing',
      fields: FORM.fields,
    });
  });

  it('404s unknown, inactive, and short tokens alike', async () => {
    mocks.find.mockResolvedValue(null);
    const missing = await GET(
      new Request('http://localhost/api/forms/TOKEN12345678901'),
      params
    );
    expect(missing.status).toBe(404);

    mocks.find.mockResolvedValue({ ...FORM, is_active: false });
    const paused = await GET(
      new Request('http://localhost/api/forms/TOKEN12345678901'),
      params
    );
    expect(paused.status).toBe(404);

    mocks.find.mockClear();
    const short = await GET(new Request('http://localhost/api/forms/x'), {
      params: Promise.resolve({ token: 'short' }),
    });
    expect(short.status).toBe(404);
    expect(mocks.find).not.toHaveBeenCalled();
  });
});
