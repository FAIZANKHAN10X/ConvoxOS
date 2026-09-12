import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  send: vi.fn(),
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

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () =>
    Response.json({ error: 'rate limited' }, { status: 429 }),
  RATE_LIMITS: { send: {} },
}));

vi.mock('@/lib/email/send', () => ({
  SendEmailError: class SendEmailError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status = 500) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
  sendEmailToConversation: mocks.send,
}));

import { POST } from './route';
import { SendEmailError } from '@/lib/email/send';

const context = {
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { id: 'conv-1' }, error: null }),
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
  return new Request('http://localhost/api/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.send.mockReset();
  mocks.requireRole.mockResolvedValue(context);
  mocks.send.mockResolvedValue({ messageId: 'msg-1', emailId: 're-1' });
});

describe('POST /api/email/send', () => {
  it('sends with subject and body', async () => {
    const response = await POST(
      request({
        conversation_id: 'conv-1',
        subject: 'Your quote',
        content_text: 'Hello',
      })
    );
    expect(response.status).toBe(200);
    expect(mocks.send).toHaveBeenCalledWith(
      context.supabase,
      'account-1',
      expect.objectContaining({
        conversationId: 'conv-1',
        subject: 'Your quote',
        contentText: 'Hello',
      })
    );
    await expect(response.json()).resolves.toMatchObject({
      message_id: 'msg-1',
      email_id: 're-1',
    });
  });

  it('rejects missing subject/body before sending', async () => {
    const response = await POST(request({ conversation_id: 'conv-1' }));
    expect(response.status).toBe(400);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('maps sender errors to responses', async () => {
    mocks.send.mockRejectedValue(new SendEmailError('email_not_configured', 'nope', 400));
    const response = await POST(
      request({ conversation_id: 'conv-1', subject: 's', content_text: 't' })
    );
    expect(response.status).toBe(400);
  });
});
