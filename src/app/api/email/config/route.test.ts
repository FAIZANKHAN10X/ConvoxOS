import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
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

vi.mock('@/lib/email/config', () => ({
  EmailConfigError: class EmailConfigError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status = 500) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
  connectEmail: mocks.connect,
  disconnectEmail: mocks.disconnect,
}));

import { GET, POST, DELETE } from './route';
import { EmailConfigError } from '@/lib/email/config';

const context = {
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    }),
  },
  accountId: 'account-1',
  userId: 'user-1',
  role: 'viewer',
  account: { id: 'account-1', name: 'Acme' },
};

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.connect.mockReset();
  mocks.disconnect.mockReset();
  mocks.requireRole.mockResolvedValue(context);
});

describe('GET /api/email/config', () => {
  it('reports disconnected status for viewers', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(mocks.requireRole).toHaveBeenCalledWith('viewer');
    await expect(response.json()).resolves.toMatchObject({ connected: false });
  });
});

describe('POST /api/email/config', () => {
  it('connects and returns one-time webhook material', async () => {
    mocks.connect.mockResolvedValue({
      config: { id: 'cfg-1' },
      webhookSecret: 's3cret',
      webhookUrl: 'https://app.test/api/email/webhook/cfg-1',
    });
    const response = await POST(
      new Request('http://localhost/api/email/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: 're_x', from_address: 'a@b.c' }),
      })
    );
    expect(response.status).toBe(200);
    expect(mocks.requireRole).toHaveBeenCalledWith('admin');
    await expect(response.json()).resolves.toMatchObject({
      webhookSecret: 's3cret',
    });
  });

  it('rejects missing fields and surfaces provider errors', async () => {
    const missing = await POST(
      new Request('http://localhost/api/email/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: 're_x' }),
      })
    );
    expect(missing.status).toBe(400);
    expect(mocks.connect).not.toHaveBeenCalled();

    mocks.connect.mockRejectedValue(new EmailConfigError('invalid_key', 'bad key', 400));
    const failed = await POST(
      new Request('http://localhost/api/email/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: 'bad', from_address: 'a@b.c' }),
      })
    );
    expect(failed.status).toBe(400);
  });
});

describe('DELETE /api/email/config', () => {
  it('disconnects as admin', async () => {
    mocks.disconnect.mockResolvedValue(undefined);
    const response = await DELETE();
    expect(response.status).toBe(200);
    expect(mocks.disconnect).toHaveBeenCalled();
  });
});
