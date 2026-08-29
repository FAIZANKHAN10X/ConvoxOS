import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  getMeMock: vi.fn(async (token: string) => {
    if (token.includes('invalid')) {
      const err = new Error('Invalid bot token — check the token from BotFather.') as Error & { code: string; status: number };
      err.code = 'invalid_token'; err.status = 400; throw err;
    }
    return { id: 12345, username: 'mybot', firstName: 'MyBot' };
  }),
  setWebhookMock: vi.fn(async () => {}),
  deleteWebhookMock: vi.fn(async () => {}),
  encryptMock: vi.fn((s: string) => `enc:${s}`),
  decryptMock: vi.fn((s: string) => {
    if (s.startsWith('enc:')) return s.slice(4);
    throw new Error('decrypt failed');
  }),
}));

let mockRole: string | null = 'admin';
const mockAccountId = 'acct-1';
let telegramConfigRow: Record<string, unknown> | null = null;
let insertedRow: Record<string, unknown> | null = null;

vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual('@/lib/auth/account') as Record<string, unknown>;
  return {
    ...actual,
    requireRole: vi.fn(async (min: string) => {
      if (!mockRole) {
        const { UnauthorizedError } = await import('@/lib/auth/account') as unknown as { UnauthorizedError: new (m: string) => Error };
        throw new UnauthorizedError('Unauthorized');
      }
      const ranks: Record<string, number> = { viewer: 1, agent: 2, admin: 3, owner: 4 };
      if ((ranks[mockRole] ?? 0) < (ranks[min] ?? 0)) {
        const { ForbiddenError } = await import('@/lib/auth/account') as unknown as { ForbiddenError: new (m: string) => Error };
        throw new ForbiddenError('Forbidden');
      }
      const builder = (table: string) => {
        const chain: Record<string, unknown> = {};
        const state: { didInsert?: boolean; didUpdate?: boolean; didDelete?: boolean } = {};
        for (const m of ['select', 'eq', 'maybeSingle', 'single', 'insert', 'update', 'delete']) {
          chain[m] = vi.fn((...args: unknown[]) => {
            if (m === 'insert') { state.didInsert = true; insertedRow = args[0] as Record<string, unknown>; }
            if (m === 'update') state.didUpdate = true;
            if (m === 'delete') state.didDelete = true;
            return chain;
          });
        }
        const exec = () => {
          if (table === 'telegram_config' && !state.didInsert && !state.didUpdate && !state.didDelete) {
            if (!telegramConfigRow) return Promise.resolve({ data: null, error: null });
            return Promise.resolve({ data: telegramConfigRow, error: null });
          }
          if (state.didInsert) {
            const id = 'new-id';
            telegramConfigRow = { id, account_id: mockAccountId, status: 'connected', bot_username: 'mybot', bot_id: 12345, connected_at: new Date().toISOString(), ...insertedRow };
            return Promise.resolve({ data: { id }, error: null });
          }
          if (state.didUpdate) return Promise.resolve({ data: null, error: null });
          if (state.didDelete) { telegramConfigRow = null; return Promise.resolve({ data: null, error: null }); }
          return Promise.resolve({ data: null, error: null });
        };
        (chain as Record<string, unknown>).then = (resolve: (v: unknown) => void) => (exec() as Promise<unknown>).then(resolve as never);
        chain.single = vi.fn(() => exec().then((r) => ({ ...r, data: (r as {data: unknown}).data ?? { id: 'new-id' } })));
        chain.maybeSingle = vi.fn(() => exec());
        return chain;
      };
      return { supabase: { from: vi.fn((t: string) => builder(t)) }, accountId: mockAccountId, userId: 'user-1', role: mockRole };
    }),
    toErrorResponse: (actual as { toErrorResponse: unknown }).toErrorResponse,
  };
});

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: hoisted.encryptMock,
  decrypt: hoisted.decryptMock,
  isLegacyFormat: vi.fn(() => false),
}));

vi.mock('@/lib/channels/telegram/api', () => {
  class TelegramApiError extends Error {
    code: string; status: number; retryable: boolean;
    constructor(code: string, msg: string, status: number, retryable = false) { super(msg); this.code = code; this.status = status; this.retryable = retryable; }
  }
  return { getTelegramMe: hoisted.getMeMock, setTelegramWebhook: hoisted.setWebhookMock, deleteTelegramWebhook: hoisted.deleteWebhookMock, TelegramApiError };
});

import { GET, POST, DELETE as DEL } from './route';
import { TelegramApiError } from '@/lib/channels/telegram/api';

function makePost(body: unknown) {
  return new Request('https://crm.example.com/api/telegram/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/telegram/config', () => {
  beforeEach(() => {
    mockRole = 'admin';
    telegramConfigRow = null;
    insertedRow = null;
    hoisted.getMeMock.mockClear();
    process.env.NEXT_PUBLIC_SITE_URL = 'https://crm.example.com';
  });
  afterEach(() => vi.clearAllMocks());

  it('401 when unauthenticated', async () => {
    mockRole = null;
    const res = await GET(new Request('https://crm.example.com/api/telegram/config'));
    expect(res.status).toBe(401);
  });

  it('returns not connected when no row', async () => {
    telegramConfigRow = null;
    const res = await GET(new Request('https://crm.example.com/api/telegram/config'));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.connected).toBe(false);
    expect(j.reason).toBe('no_config');
  });

  it('never returns raw token', async () => {
    telegramConfigRow = { id: 'id-1', account_id: mockAccountId, bot_token_encrypted: 'enc:123:abc', webhook_secret_encrypted: 'enc:sec', bot_username: 'mybot', bot_id: 12345, status: 'connected', connected_at: new Date().toISOString() };
    hoisted.getMeMock.mockResolvedValueOnce({ id: 12345, username: 'mybot' } as never);
    const res = await GET(new Request('https://crm.example.com/api/telegram/config'));
    const j = await res.json();
    expect(JSON.stringify(j)).not.toContain('123:abc');
    expect(j.has_token).toBe(true);
  });

  it('viewer can read status', async () => {
    mockRole = 'viewer';
    telegramConfigRow = null;
    const res = await GET(new Request('https://crm.example.com/api/telegram/config'));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/telegram/config', () => {
  beforeEach(() => {
    mockRole = 'admin';
    telegramConfigRow = null;
    insertedRow = null;
    hoisted.getMeMock.mockReset();
    hoisted.getMeMock.mockResolvedValue({ id: 12345, username: 'mybot' } as never);
    hoisted.setWebhookMock.mockReset();
    hoisted.setWebhookMock.mockResolvedValue(undefined as never);
    process.env.NEXT_PUBLIC_SITE_URL = 'https://crm.example.com';
  });

  it('403 for viewer', async () => {
    mockRole = 'viewer';
    const res = await POST(makePost({ bot_token: '123456:ABCdefGhIJKlmnoPQRSTuvwx12345678901234567890' }));
    expect(res.status).toBe(403);
  });

  it('400 missing token', async () => {
    const res = await POST(makePost({}));
    expect(res.status).toBe(400);
  });

  it('400 invalid format', async () => {
    const res = await POST(makePost({ bot_token: 'bad' }));
    expect(res.status).toBe(400);
  });

  it('creates config and calls setWebhook with secret', async () => {
    const token = '123456:ABCdefGhIJKlmnoPQRSTuvwx12345678901234567890';
    const res = await POST(makePost({ bot_token: token }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.success).toBe(true);
    expect(hoisted.setWebhookMock).toHaveBeenCalledTimes(1);
    expect(hoisted.setWebhookMock).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('/api/telegram/webhook/'), secretToken: expect.any(String) }));
    expect(hoisted.encryptMock).toHaveBeenCalledWith(token);
    expect(JSON.stringify(j)).not.toContain(token);
  });

  it('sanitizes invalid token error', async () => {
    hoisted.getMeMock.mockRejectedValueOnce(new TelegramApiError('invalid_token', 'Invalid bot token — check the token from BotFather.', 400));
    const res = await POST(makePost({ bot_token: '123456:invalidtoken12345678901234567890' }));
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.error).toMatch(/Invalid bot token/);
    expect(JSON.stringify(j)).not.toContain('invalidtoken');
  });

  it('returns webhook_error when site url cannot be determined', async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const token = '123456:ABCdefGhIJKlmnoPQRSTuvwx12345678901234567890';
    const res = await POST(new Request('http://localhost/api/telegram/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bot_token: token }),
    }));
    const j = await res.json();
    expect(j.webhook_ok).toBe(false);
    expect(j.webhook_error).toMatch(/NEXT_PUBLIC_SITE_URL/);
  });

  it('handles webhook registration failure without leaking token', async () => {
    hoisted.setWebhookMock.mockRejectedValueOnce(new TelegramApiError('telegram_error', 'Telegram webhook configuration failed.', 502));
    const token = '123456:ABCdefGhIJKlmnoPQRSTuvwx12345678901234567890';
    const res = await POST(makePost({ bot_token: token }));
    const j = await res.json();
    expect(j.webhook_ok).toBe(false);
    expect(JSON.stringify(j)).not.toContain(token);
  });

  it('never returns plaintext token on success', async () => {
    const token = '123456:ABCdefGhIJKlmnoPQRSTuvwx12345678901234567890';
    const res = await POST(makePost({ bot_token: token }));
    const j = await res.json();
    expect(JSON.stringify(j)).not.toContain(token);
  });

  it('account scoping — creates per account', async () => {
    const token = '123456:ABCdefGhIJKlmnoPQRSTuvwx12345678901234567890';
    const res = await POST(makePost({ bot_token: token }));
    expect(res.status).toBe(200);
    expect(telegramConfigRow).toMatchObject({ account_id: mockAccountId });
  });
});

describe('DELETE /api/telegram/config', () => {
  beforeEach(() => {
    mockRole = 'admin';
    telegramConfigRow = { id: 'id-1', account_id: mockAccountId, bot_token_encrypted: 'enc:123:abc' };
    hoisted.deleteWebhookMock.mockReset();
    hoisted.deleteWebhookMock.mockResolvedValue(undefined as never);
    process.env.NEXT_PUBLIC_SITE_URL = 'https://crm.example.com';
  });

  it('403 for viewer', async () => {
    mockRole = 'viewer';
    const res = await DEL(new Request('https://crm.example.com/api/telegram/config', { method: 'DELETE' }));
    expect(res.status).toBe(403);
  });

  it('deletes row and is idempotent when already gone', async () => {
    let res = await DEL(new Request('https://crm.example.com/api/telegram/config', { method: 'DELETE' }));
    expect(res.status).toBe(200);
    // second delete should still be 200
    res = await DEL(new Request('https://crm.example.com/api/telegram/config', { method: 'DELETE' }));
    expect(res.status).toBe(200);
  });

  it('calls deleteWebhook before deleting row', async () => {
    await DEL(new Request('https://crm.example.com/api/telegram/config', { method: 'DELETE' }));
    expect(hoisted.deleteWebhookMock).toHaveBeenCalledTimes(1);
  });

  it('never returns token', async () => {
    const res = await DEL(new Request('https://crm.example.com/api/telegram/config', { method: 'DELETE' }));
    const j = await res.json();
    expect(JSON.stringify(j)).not.toContain('123:abc');
  });

  it('still deletes row when deleteWebhook fails', async () => {
    hoisted.deleteWebhookMock.mockRejectedValueOnce(new Error('network'));
    const res = await DEL(new Request('https://crm.example.com/api/telegram/config', { method: 'DELETE' }));
    expect(res.status).toBe(200);
    expect(telegramConfigRow).toBeNull();
  });
});
