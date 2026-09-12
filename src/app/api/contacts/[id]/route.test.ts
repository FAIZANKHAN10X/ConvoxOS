import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  update: vi.fn(),
  emitUpdated: vi.fn(),
}));

vi.mock('@/lib/contacts/write', () => ({
  ContactWriteError: class ContactWriteError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  },
  hashPatch: () => 'hash',
  updateContact: mocks.update,
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

vi.mock('@/lib/automation/crm-events', () => ({
  emitContactUpdated: mocks.emitUpdated,
}));

import { PATCH } from './route';
import { ContactWriteError } from '@/lib/contacts/write';

const context = {
  supabase: { name: 'scoped-client' },
  accountId: 'account-1',
  userId: 'user-1',
  role: 'agent',
  account: { id: 'account-1', name: 'Acme' },
};

function request(body: unknown) {
  return new Request('http://localhost/api/contacts/contact-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: 'contact-1' }) };

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.update.mockReset();
  mocks.emitUpdated.mockReset();
  mocks.requireRole.mockResolvedValue(context);
});

describe('PATCH /api/contacts/[id]', () => {
  it('updates through the writer and emits on change', async () => {
    mocks.update.mockResolvedValue({
      contact: { id: 'contact-1' },
      changedFields: ['name'],
    });

    const response = await PATCH(request({ name: 'Ann Lee' }), params);

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(context.supabase, {
      accountId: 'account-1',
      contactId: 'contact-1',
      patch: { name: 'Ann Lee' },
    });
    expect(mocks.emitUpdated).toHaveBeenCalledTimes(1);
  });

  it('emits nothing when nothing changes', async () => {
    mocks.update.mockResolvedValue({
      contact: { id: 'contact-1' },
      changedFields: [],
    });

    const response = await PATCH(request({ name: 'Ann' }), params);

    expect(response.status).toBe(200);
    expect(mocks.emitUpdated).not.toHaveBeenCalled();
  });

  it('maps writer 409s to 409 responses', async () => {
    mocks.update.mockRejectedValue(new ContactWriteError('conflict', 409));

    const response = await PATCH(request({ phone: '+14155550200' }), params);

    expect(response.status).toBe(409);
    expect(mocks.emitUpdated).not.toHaveBeenCalled();
  });

  it('rejects empty patches before writing', async () => {
    const response = await PATCH(request({}), params);
    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
