import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setDealStatus: vi.fn(),
  emit: vi.fn(),
}));

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({
    supabase: {},
    accountId: 'acct-1',
    userId: 'user-1',
  })),
  toErrorResponse: (error: unknown) =>
    Response.json({ error: error instanceof Error ? error.message : 'error' }, { status: 500 }),
}));

vi.mock('@/lib/deals/write', () => ({
  setDealStatus: mocks.setDealStatus,
  DealWriteError: class DealWriteError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock('@/lib/automation/crm-events', () => ({
  emitDealStatusChanged: mocks.emit,
}));

import { PATCH } from './route';

const params = { params: Promise.resolve({ id: 'deal-1' }) };

function req(body: unknown) {
  return new Request('http://localhost/api/deals/deal-1/status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.setDealStatus.mockReset();
  mocks.emit.mockReset();
});

describe('PATCH /api/deals/[id]/status', () => {
  it('marks won and emits deal_status_changed', async () => {
    mocks.setDealStatus.mockResolvedValue({
      changed: true,
      deal: { id: 'deal-1', contact_id: 'c1', pipeline_id: 'p1', status: 'won' },
      fromStatus: 'open',
    });
    const res = await PATCH(req({ status: 'won' }), params);
    expect(res.status).toBe(200);
    expect(mocks.setDealStatus).toHaveBeenCalledWith(
      expect.anything(),
      { accountId: 'acct-1', dealId: 'deal-1', status: 'won', lostReason: null }
    );
    expect(mocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 'c1',
        dealId: 'deal-1',
        idempotencyKey: 'deal_status_changed:deal-1:open:won',
      })
    );
  });

  it('marks lost with a reason', async () => {
    mocks.setDealStatus.mockResolvedValue({
      changed: true,
      deal: { id: 'deal-1', contact_id: 'c1', pipeline_id: 'p1', status: 'lost' },
      fromStatus: 'open',
    });
    const res = await PATCH(req({ status: 'lost', lost_reason: 'no budget' }), params);
    expect(res.status).toBe(200);
    expect(mocks.setDealStatus).toHaveBeenCalledWith(
      expect.anything(),
      { accountId: 'acct-1', dealId: 'deal-1', status: 'lost', lostReason: 'no budget' }
    );
  });

  it('does not emit when unchanged', async () => {
    mocks.setDealStatus.mockResolvedValue({
      changed: false,
      deal: { id: 'deal-1', contact_id: 'c1', pipeline_id: 'p1', status: 'won' },
      fromStatus: 'won',
    });
    const res = await PATCH(req({ status: 'won' }), params);
    expect(res.status).toBe(200);
    expect(mocks.emit).not.toHaveBeenCalled();
  });

  it('rejects invalid status', async () => {
    const res = await PATCH(req({ status: 'maybe' }), params);
    expect(res.status).toBe(400);
    expect(mocks.setDealStatus).not.toHaveBeenCalled();
  });
});
