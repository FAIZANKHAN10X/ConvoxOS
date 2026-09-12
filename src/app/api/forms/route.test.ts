import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
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

vi.mock('@/lib/forms/write', () => ({
  FormWriteError: class FormWriteError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  },
  normalizeFormFields: (v: unknown) => v,
  createLeadForm: mocks.create,
  updateLeadForm: mocks.update,
}));

import { GET, POST } from './route';
import { PATCH, DELETE } from './[id]/route';

const context = {
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: async () => ({ data: [], error: null }),
          }),
        }),
      }),
      delete: () => ({
        eq: () => ({
          eq: async () => ({ error: null }),
        }),
      }),
    }),
  },
  accountId: 'account-1',
  userId: 'user-1',
  role: 'agent',
  account: { id: 'account-1', name: 'Acme' },
};

const adminContext = { ...context, role: 'admin' };

function request(body: unknown, method = 'POST') {
  return new Request('http://localhost/api/forms', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: 'form-1' }) };

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.create.mockReset();
  mocks.update.mockReset();
  mocks.requireRole.mockResolvedValue(context);
});

describe('GET /api/forms', () => {
  it('lists forms for the account', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(mocks.requireRole).toHaveBeenCalledWith('agent');
  });
});

describe('POST /api/forms', () => {
  it('creates a form and returns the one-time token', async () => {
    mocks.create.mockResolvedValue({
      form: { id: 'form-1' },
      token: 'raw-token',
    });
    const response = await POST(
      request({ name: 'Landing', fields: [] })
    );
    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(
      context.supabase,
      expect.objectContaining({ accountId: 'account-1', userId: 'user-1' })
    );
    await expect(response.json()).resolves.toMatchObject({
      token: 'raw-token',
    });
  });

  it('rejects a missing name before writing', async () => {
    const response = await POST(request({ fields: [] }));
    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/forms/[id]', () => {
  it('updates through the writer', async () => {
    mocks.update.mockResolvedValue({ id: 'form-1' });
    const response = await PATCH(request({ name: 'New' }, 'PATCH'), params);
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(
      context.supabase,
      expect.objectContaining({
        accountId: 'account-1',
        formId: 'form-1',
        name: 'New',
      })
    );
  });
});

describe('DELETE /api/forms/[id]', () => {
  it('requires admin', async () => {
    mocks.requireRole.mockResolvedValue(adminContext);
    const response = await DELETE(
      new Request('http://localhost/api/forms/form-1', { method: 'DELETE' }),
      params
    );
    expect(response.status).toBe(200);
    expect(mocks.requireRole).toHaveBeenCalledWith('admin');
  });
});
