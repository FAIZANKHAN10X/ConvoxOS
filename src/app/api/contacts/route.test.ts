import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  findOrCreate: vi.fn(),
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

vi.mock('@/lib/api/v1/contacts', () => ({
  findOrCreateContact: mocks.findOrCreate,
}));

vi.mock('@/lib/automation/crm-events', () => ({
  emitContactCreated: mocks.emitCreated,
}));

import { POST } from './route';

const context = {
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { id: 'contact-1' }, error: null }),
          }),
        }),
      }),
    }),
  },
  accountId: 'account-1',
  userId: 'user-1',
  role: 'agent',
  account: { id: 'account-1', name: 'Acme' },
};

function request(body: unknown) {
  return new Request('http://localhost/api/contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.findOrCreate.mockReset();
  mocks.emitCreated.mockReset();
  mocks.requireRole.mockResolvedValue(context);
});

describe('POST /api/contacts', () => {
  it('creates a contact and emits contact_created(manual)', async () => {
    mocks.findOrCreate.mockResolvedValue({ id: 'contact-1', created: true });

    const response = await POST(request({ phone: '+14155550100', name: 'Ann' }));

    expect(response.status).toBe(201);
    expect(mocks.findOrCreate).toHaveBeenCalledWith(
      context.supabase,
      'account-1',
      'user-1',
      expect.objectContaining({ phone: '+14155550100' })
    );
    expect(mocks.emitCreated).toHaveBeenCalledTimes(1);
    expect(mocks.emitCreated).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'account-1', contactId: 'contact-1' })
    );
  });

  it('emits nothing on dedupe hits', async () => {
    mocks.findOrCreate.mockResolvedValue({ id: 'contact-9', created: false });

    const response = await POST(request({ phone: '+14155550900' }));

    expect(response.status).toBe(200);
    expect(mocks.emitCreated).not.toHaveBeenCalled();
  });

  it('rejects a missing phone before writing', async () => {
    const response = await POST(request({ name: 'No phone' }));
    expect(response.status).toBe(400);
    expect(mocks.findOrCreate).not.toHaveBeenCalled();
  });
});
