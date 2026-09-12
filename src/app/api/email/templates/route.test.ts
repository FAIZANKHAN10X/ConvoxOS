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

vi.mock('@/lib/email/templates', () => ({
  EmailTemplateError: class EmailTemplateError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  },
  createEmailTemplate: mocks.create,
  updateEmailTemplate: mocks.update,
}));

import { GET, POST } from './route';
import { PATCH, DELETE } from './[id]/route';
import { EmailTemplateError } from '@/lib/email/templates';

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

function request(body: unknown, method = 'POST', url = 'http://localhost/api/email/templates') {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: 'tpl-1' }) };

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.create.mockReset();
  mocks.update.mockReset();
  mocks.requireRole.mockResolvedValue(context);
});

describe('GET /api/email/templates', () => {
  it('lists templates', async () => {
    const response = await GET(
      new Request('http://localhost/api/email/templates')
    );
    expect(response.status).toBe(200);
  });
});

describe('POST /api/email/templates', () => {
  it('creates a template (201)', async () => {
    mocks.create.mockResolvedValue({ id: 'tpl-1', name: 'Welcome' });
    const response = await POST(
      request({ name: 'Welcome', subject: 'Hi', body_text: 'Hello' })
    );
    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(
      context.supabase,
      expect.objectContaining({ accountId: 'account-1', userId: 'user-1' })
    );
  });

  it('maps writer errors', async () => {
    mocks.create.mockRejectedValue(new EmailTemplateError('dup', 409));
    const response = await POST(
      request({ name: 'Welcome', subject: 'Hi', body_text: 'Hello' })
    );
    expect(response.status).toBe(409);
  });
});

describe('PATCH /api/email/templates/[id]', () => {
  it('updates through the writer', async () => {
    mocks.update.mockResolvedValue({ id: 'tpl-1' });
    const response = await PATCH(
      request({ subject: 'New' }, 'PATCH', 'http://localhost/api/email/templates/tpl-1'),
      params
    );
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(
      context.supabase,
      expect.objectContaining({ templateId: 'tpl-1', subject: 'New' })
    );
  });
});

describe('DELETE /api/email/templates/[id]', () => {
  it('requires admin', async () => {
    const response = await DELETE(
      new Request('http://localhost/api/email/templates/tpl-1', { method: 'DELETE' }),
      params
    );
    expect(response.status).toBe(200);
    expect(mocks.requireRole).toHaveBeenCalledWith('admin');
  });
});
