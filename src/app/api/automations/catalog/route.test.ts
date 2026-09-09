import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: mocks.getCurrentAccount,
  toErrorResponse: vi.fn(() =>
    Response.json({ error: 'auth failed' }, { status: 403 })
  ),
}));

import { GET } from './route';

describe('GET /api/automations/catalog', () => {
  beforeEach(() => {
    mocks.getCurrentAccount.mockReset();
    mocks.getCurrentAccount.mockResolvedValue({ accountId: 'acct-1' });
  });

  it('returns registry nodes so the picker is not hardcoded', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    const types = body.nodes.map((n: { type: string }) => n.type);
    expect(types).toContain('trigger.tag_added');
    expect(types).toContain('action.send_text');
  });
});
