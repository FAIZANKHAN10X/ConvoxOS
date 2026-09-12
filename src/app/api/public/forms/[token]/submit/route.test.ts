import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  find: vi.fn(),
  ingest: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  toErrorResponse: vi.fn((error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : 'error' },
      { status: 500 }
    )
  ),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: mocks.admin,
}));

vi.mock('@/lib/forms/write', () => ({
  FormWriteError: class FormWriteError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  },
  hashFormToken: (t: string) => `hash:${t}`,
  findFormByTokenHash: mocks.find,
  ingestSubmission: mocks.ingest,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () =>
    Response.json({ error: 'rate limited' }, { status: 429 }),
  RATE_LIMITS: { publicApi: {} },
}));

import { POST } from './route';
import { FormWriteError } from '@/lib/forms/write';

const FORM = {
  id: 'form-1',
  account_id: 'account-1',
  name: 'Landing',
  fields: [],
  is_active: true,
};

const DB = {
  from: (table: string) => {
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

function request(body: unknown) {
  return new Request('http://localhost/api/forms/TOKEN12345678901/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ token: 'TOKEN12345678901' }) };

beforeEach(() => {
  mocks.admin.mockReset();
  mocks.find.mockReset();
  mocks.ingest.mockReset();
  mocks.admin.mockReturnValue(DB);
  mocks.find.mockResolvedValue(FORM);
});

describe('POST /api/forms/[token]/submit', () => {
  it('ingests a valid submission (201)', async () => {
    mocks.ingest.mockResolvedValue({
      submission: { id: 'sub-1' },
      contactId: 'contact-1',
      contactCreated: true,
      deduped: false,
    });
    const response = await POST(
      request({ values: { phone: '+14155550100' } }),
      params
    );
    expect(response.status).toBe(201);
    expect(mocks.ingest).toHaveBeenCalledWith(
      DB,
      expect.objectContaining({ accountId: 'account-1', auditUserId: 'user-1' })
    );
    await expect(response.json()).resolves.toMatchObject({
      submission_id: 'sub-1',
      contact_id: 'contact-1',
      deduped: false,
    });
  });

  it('returns 200 on deduped resubmits', async () => {
    mocks.ingest.mockResolvedValue({
      submission: { id: 'sub-1' },
      contactId: 'contact-1',
      contactCreated: false,
      deduped: true,
    });
    const response = await POST(
      request({ values: {}, submission_key: 'k' }),
      params
    );
    expect(response.status).toBe(200);
  });

  it('404s unknown or inactive forms alike', async () => {
    mocks.find.mockResolvedValue(null);
    const missing = await POST(request({ values: {} }), params);
    expect(missing.status).toBe(404);
    expect(mocks.ingest).not.toHaveBeenCalled();

    mocks.find.mockResolvedValue({ ...FORM, is_active: false });
    const paused = await POST(request({ values: {} }), params);
    expect(paused.status).toBe(404);
    expect(mocks.ingest).not.toHaveBeenCalled();
  });

  it('maps writer validation to 400', async () => {
    mocks.ingest.mockRejectedValue(new FormWriteError('bad phone', 400));
    const response = await POST(request({ values: {} }), params);
    expect(response.status).toBe(400);
  });

  it('rejects short tokens before lookup', async () => {
    const response = await POST(request({ values: {} }), {
      params: Promise.resolve({ token: 'short' }),
    });
    expect(response.status).toBe(404);
    expect(mocks.find).not.toHaveBeenCalled();
  });
});
