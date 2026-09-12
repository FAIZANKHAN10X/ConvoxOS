import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  create: vi.fn(),
  emitCreated: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn((error: unknown) =>
    Response.json(
      { error: error instanceof Error ? error.message : 'error' },
      { status: 500 }
    )
  ),
}));

vi.mock('@/lib/deals/write', () => ({
  DealWriteError: class DealWriteError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  },
  createDeal: mocks.create,
}));

vi.mock('@/lib/automation/crm-events', () => ({
  emitDealCreated: mocks.emitCreated,
}));

import { POST } from './route';

const context = {
  supabase: { name: 'scoped-client' },
  accountId: 'account-1',
  userId: 'user-1',
  role: 'agent',
  account: { id: 'account-1', name: 'Acme' },
};

function request(body: unknown) {
  return new Request('http://localhost/api/deals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const BODY = {
  title: 'New deal',
  pipeline_id: 'pipe-1',
  stage_id: 'stage-1',
  contact_id: 'contact-1',
};

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.create.mockReset();
  mocks.emitCreated.mockReset();
  mocks.requireRole.mockResolvedValue(context);
});

describe('POST /api/deals', () => {
  it('creates a deal and emits deal_created', async () => {
    mocks.create.mockResolvedValue({
      id: 'deal-1',
      account_id: 'account-1',
      pipeline_id: 'pipe-1',
      stage_id: 'stage-1',
      contact_id: 'contact-1',
      title: 'New deal',
      status: 'open',
      value: 0,
    });

    const response = await POST(request(BODY));

    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(
      context.supabase,
      expect.objectContaining({
        accountId: 'account-1',
        userId: 'user-1',
        title: 'New deal',
      })
    );
    expect(mocks.emitCreated).toHaveBeenCalledTimes(1);
  });

  it('rejects missing fields before writing', async () => {
    const response = await POST(request({ title: 'No refs' }));
    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
