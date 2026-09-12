import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  update: vi.fn(),
  emitUpdated: vi.fn(),
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
  updateDeal: mocks.update,
}));

vi.mock('@/lib/automation/crm-events', () => ({
  emitDealUpdated: mocks.emitUpdated,
}));

import { PATCH } from './route';
import { DealWriteError } from '@/lib/deals/write';

const context = {
  supabase: { name: 'scoped-client' },
  accountId: 'account-1',
  userId: 'user-1',
  role: 'agent',
  account: { id: 'account-1', name: 'Acme' },
};

function request(body: unknown) {
  return new Request('http://localhost/api/deals/deal-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: 'deal-1' }) };

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.update.mockReset();
  mocks.emitUpdated.mockReset();
  mocks.requireRole.mockResolvedValue(context);
});

describe('PATCH /api/deals/[id]', () => {
  it('updates through the writer and emits on change', async () => {
    mocks.update.mockResolvedValue({
      deal: { id: 'deal-1', contact_id: 'contact-1', pipeline_id: 'pipe-1' },
      changedFields: ['title'],
    });

    const response = await PATCH(request({ title: 'Bigger' }), params);

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(context.supabase, {
      accountId: 'account-1',
      dealId: 'deal-1',
      patch: { title: 'Bigger' },
    });
    expect(mocks.emitUpdated).toHaveBeenCalledTimes(1);
  });

  it('emits nothing when nothing changes', async () => {
    mocks.update.mockResolvedValue({
      deal: { id: 'deal-1', contact_id: 'contact-1', pipeline_id: 'pipe-1' },
      changedFields: [],
    });

    const response = await PATCH(request({ title: 'Same' }), params);

    expect(response.status).toBe(200);
    expect(mocks.emitUpdated).not.toHaveBeenCalled();
  });

  it('maps writer 404s to 404 responses', async () => {
    mocks.update.mockRejectedValue(new DealWriteError('Deal not found', 404));

    const response = await PATCH(request({ title: 'X' }), params);

    expect(response.status).toBe(404);
    expect(mocks.emitUpdated).not.toHaveBeenCalled();
  });

  it('rejects empty patches before writing', async () => {
    const response = await PATCH(request({}), params);
    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
