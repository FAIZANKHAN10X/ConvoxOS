import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  requireRole: vi.fn(),
  getAutomation: vi.fn(),
  deleteAutomation: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: mocks.getCurrentAccount,
  requireRole: mocks.requireRole,
  toErrorResponse: (err: { status?: number; message?: string }) =>
    Response.json(
      { error: err.message ?? 'auth failed' },
      { status: err.status ?? 403 }
    ),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({}),
}));

vi.mock('@/lib/automation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/automation')>();
  return {
    ...actual,
    createPostgresStore: () => ({
      getAutomation: mocks.getAutomation,
      deleteAutomation: mocks.deleteAutomation,
    }),
  };
});

import { DELETE, GET } from './route';

const AUTO = {
  id: 'auto-1',
  accountId: 'acct-1',
  name: 'Welcome',
};

describe('GET /api/automations/[id]', () => {
  beforeEach(() => {
    mocks.getCurrentAccount.mockReset();
    mocks.getAutomation.mockReset();
    mocks.getCurrentAccount.mockResolvedValue({
      supabase: {},
      accountId: 'acct-1',
    });
  });

  it('returns 404 when missing or foreign', async () => {
    mocks.getAutomation.mockResolvedValueOnce(null);
    const missing = await GET(new Request('http://x/api/automations/auto-1'), {
      params: Promise.resolve({ id: 'auto-1' }),
    });
    expect(missing.status).toBe(404);

    mocks.getAutomation.mockResolvedValueOnce({
      ...AUTO,
      accountId: 'other',
    });
    const foreign = await GET(new Request('http://x/api/automations/auto-1'), {
      params: Promise.resolve({ id: 'auto-1' }),
    });
    expect(foreign.status).toBe(404);
  });
});

describe('DELETE /api/automations/[id]', () => {
  beforeEach(() => {
    mocks.requireRole.mockReset();
    mocks.getAutomation.mockReset();
    mocks.deleteAutomation.mockReset();
    mocks.requireRole.mockResolvedValue({
      supabase: {},
      accountId: 'acct-1',
      userId: 'user-1',
    });
    mocks.getAutomation.mockResolvedValue(AUTO);
    mocks.deleteAutomation.mockResolvedValue(undefined);
  });

  it('deletes an automation in the caller account', async () => {
    const response = await DELETE(
      new Request('http://x/api/automations/auto-1', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'auto-1' }) }
    );
    expect(response.status).toBe(200);
    expect(mocks.deleteAutomation).toHaveBeenCalledWith('auto-1');
    await expect(response.json()).resolves.toEqual({ deleted: true });
  });

  it('returns 404 for a missing automation', async () => {
    mocks.getAutomation.mockResolvedValueOnce(null);
    const response = await DELETE(
      new Request('http://x/api/automations/nope', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'nope' }) }
    );
    expect(response.status).toBe(404);
    expect(mocks.deleteAutomation).not.toHaveBeenCalled();
  });
});
