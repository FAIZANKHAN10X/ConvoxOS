import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  requireRole: vi.fn(),
  insertAutomation: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: mocks.getCurrentAccount,
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() =>
    Response.json({ error: 'auth failed' }, { status: 403 })
  ),
}));

vi.mock('@/lib/automation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/automation')>();
  return {
    ...actual,
    createPostgresStore: () => ({
      insertAutomation: mocks.insertAutomation,
    }),
  };
});

import { POST } from './route';

describe('POST /api/automations', () => {
  beforeEach(() => {
    mocks.requireRole.mockReset();
    mocks.insertAutomation.mockReset();
    mocks.requireRole.mockResolvedValue({
      supabase: {},
      accountId: 'acct-1',
      userId: 'user-1',
    });
    mocks.insertAutomation.mockResolvedValue({
      id: 'auto-1',
      name: 'Untitled automation',
      status: 'draft',
    });
  });

  it('creates a draft and returns it', async () => {
    const response = await POST();
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.automation.id).toBe('auto-1');
    expect(mocks.insertAutomation).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-1',
        createdBy: 'user-1',
        name: 'Untitled automation',
      })
    );
  });
});
