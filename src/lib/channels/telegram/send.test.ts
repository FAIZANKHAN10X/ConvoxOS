import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  decrypt: vi.fn((v: string) => 'decrypted-token'),
  encrypt: vi.fn((v: string) => `enc-${v}`),
  isLegacyFormat: vi.fn(() => false),
  fetchMock: vi.fn(),
}));

vi.mock('@/lib/crypto/encryption', () => ({
  decrypt: h.decrypt,
  encrypt: h.encrypt,
  isLegacyFormat: h.isLegacyFormat,
}));

global.fetch = h.fetchMock as unknown as typeof fetch;

import { sendTelegramText, SendTelegramError } from '@/lib/channels/telegram/send';

type TestDb = Parameters<typeof sendTelegramText>[0];
type TestOverrides = {
  conversation?: Record<string, unknown>;
  config?: Record<string, unknown>;
  parentMessage?: Record<string, unknown> | null;
  replyMode?: boolean;
  insertError?: boolean;
};

function makeDb(overrides: TestOverrides = {}) {
  const conversation = {
    id: 'conv-1',
    account_id: 'acc-1',
    contact: { id: 'contact-1', telegram_user_id: 123, telegram_chat_id: 123, account_id: 'acc-1' },
    ...overrides.conversation,
  };
  const config = {
    id: 'cfg-1',
    account_id: 'acc-1',
    bot_token_encrypted: 'enc-token',
    ...overrides.config,
  };
  const parentMessage = overrides.parentMessage;
  return {
    from: vi.fn((table: string) => {
      if (table === 'conversations') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({ data: conversation, error: null }),
              }),
            }),
          }),
          update: vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) })),
        } as unknown as TestDb;
      }
      if (table === 'telegram_config') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: config, error: null }),
            }),
          }),
          update: vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) })),
        } as unknown as TestDb;
      }
      if (table === 'messages' && overrides.replyMode) {
        // reply lookup
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: parentMessage, error: null }),
              }),
            }),
          }),
          insert: vi.fn(() => ({
            select: () => ({
              single: async () => ({ data: { id: 'msg-1' }, error: null }),
            }),
          })),
        } as unknown as TestDb;
      }
      if (table === 'messages' && !overrides.replyMode) {
        // Check if this is the reply lookup vs insert
        // We need to distinguish by call count; simpler: mock both
        return {
          select: vi.fn(() => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: parentMessage ?? null, error: null }),
              }),
            }),
          })),
          insert: vi.fn(() => ({
            select: () => ({
              single: async () =>
                overrides.insertError
                  ? { data: null, error: { message: 'db fail' } }
                  : { data: { id: 'msg-1' }, error: null },
            }),
          })),
        } as unknown as TestDb;
      }
      return {
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
        insert: vi.fn(() => ({ select: () => ({ single: async () => ({ data: { id: 'msg-1' }, error: null }) }) })),
        update: vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) })),
      } as unknown as TestDb;
    }),
  } as unknown as TestDb;
}

describe('sendTelegramText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.decrypt.mockReturnValue('decrypted-token');
    h.isLegacyFormat.mockReturnValue(false);
    h.fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 42 } }),
    });
  });

  it('requires conversation_id', async () => {
    await expect(sendTelegramText(makeDb(), 'acc-1', { conversationId: '', contentText: 'hi' })).rejects.toMatchObject({ code: 'bad_request', status: 400 });
  });

  it('requires content_text', async () => {
    await expect(sendTelegramText(makeDb(), 'acc-1', { conversationId: 'conv-1', contentText: '' })).rejects.toMatchObject({ code: 'bad_request' });
    await expect(sendTelegramText(makeDb(), 'acc-1', { conversationId: 'conv-1', contentText: '   ' })).rejects.toMatchObject({ code: 'bad_request' });
  });

  it('rejects text over 4096', async () => {
    await expect(
      sendTelegramText(makeDb(), 'acc-1', { conversationId: 'conv-1', contentText: 'a'.repeat(4097) })
    ).rejects.toMatchObject({ code: 'bad_request' });
  });

  it('fails when contact has no telegram_user_id', async () => {
    const db = makeDb({ conversation: { id: 'conv-1', account_id: 'acc-1', contact: { id: 'c', telegram_user_id: null } } });
    await expect(sendTelegramText(db as TestDb, 'acc-1', { conversationId: 'conv-1', contentText: 'hi' })).rejects.toMatchObject({ code: 'bad_request' });
  });

  it('fails when telegram_config missing', async () => {
    const db = {
      from: vi.fn((table: string) => {
        if (table === 'conversations') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  single: async () => ({ data: { id: 'conv-1', account_id: 'acc-1', contact: { id: 'c', telegram_user_id: 123, telegram_chat_id: 123 } }, error: null }),
                }),
              }),
            }),
          } as unknown as TestDb;
        }
        if (table === 'telegram_config') {
          return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
          } as unknown as TestDb;
        }
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) } as unknown as TestDb;
      }),
    } as unknown as TestDb;
    await expect(sendTelegramText(db as TestDb, 'acc-1', { conversationId: 'conv-1', contentText: 'hi' })).rejects.toMatchObject({ code: 'telegram_not_configured' });
  });

  it('sends text to Telegram and persists with channel telegram', async () => {
    const db = makeDb() as unknown as TestDb & { from: ReturnType<typeof vi.fn> };
    // Mock messages insert + conversations update + telegram_config + reply lookup
    let capturedInsert: Record<string, unknown> = {};
    const baseFrom = db.from;
    (db as unknown as { from: ReturnType<typeof vi.fn> }).from = vi.fn((table: string) => {
      if (table === 'conversations') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({ data: { id: 'conv-1', account_id: 'acc-1', contact: { id: 'contact-1', telegram_user_id: 123, telegram_chat_id: 123 } }, error: null }),
              }),
            }),
          }),
          update: vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) })),
        } as unknown as TestDb;
      }
      if (table === 'telegram_config') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'cfg-1', account_id: 'acc-1', bot_token_encrypted: 'enc' }, error: null }) }) }),
        } as unknown as TestDb;
      }
      if (table === 'messages') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
            }),
          }),
          insert: vi.fn((row: Record<string, unknown>) => {
            capturedInsert = row;
            return { select: () => ({ single: async () => ({ data: { id: 'msg-1' }, error: null }) }) } as unknown as TestDb;
          }),
        } as unknown as TestDb;
      }
      return baseFrom(table);
    });

    const result = await sendTelegramText(db, 'acc-1', { conversationId: 'conv-1', contentText: 'hello' });
    expect(result.messageId).toBe('msg-1');
    expect(result.telegramMessageId).toBe('tg_123_42');
    expect(h.fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('https://api.telegram.org/botdecrypted-token/sendMessage'),
      expect.objectContaining({ method: 'POST' })
    );
    const body = JSON.parse((h.fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.chat_id).toBe(123);
    expect(body.text).toBe('hello');
    expect(capturedInsert.channel).toBe('telegram');
    expect(capturedInsert.content_type).toBe('text');
    expect(capturedInsert.message_id).toBe('tg_123_42');
  });

  it('handles Telegram API error as 502', async () => {
    h.fetchMock.mockResolvedValue({ ok: false, json: async () => ({ ok: false, description: 'Unauthorized' }) } as Response);
    const db = makeDb() as unknown as TestDb & { from: ReturnType<typeof vi.fn> };
    // Patch from to handle telegram_config + conversations
    const baseFrom = db.from;
    (db as unknown as { from: ReturnType<typeof vi.fn> }).from = vi.fn((table: string) => {
      if (table === 'conversations') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({ data: { id: 'conv-1', account_id: 'acc-1', contact: { id: 'c', telegram_user_id: 123, telegram_chat_id: 123 } }, error: null }),
              }),
            }),
          }),
        } as unknown as TestDb;
      }
      if (table === 'telegram_config') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'cfg-1', account_id: 'acc-1', bot_token_encrypted: 'enc' }, error: null }) }) }),
        } as unknown as TestDb;
      }
      if (table === 'messages') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
          insert: vi.fn(() => ({ select: () => ({ single: async () => ({ data: { id: 'msg-1' }, error: null }) }) })),
        } as unknown as TestDb;
      }
      return baseFrom(table);
    });
    await expect(sendTelegramText(db, 'acc-1', { conversationId: 'conv-1', contentText: 'hi' })).rejects.toMatchObject({ code: 'telegram_error', status: 502 });
  });

  it('surfaces db error after Telegram success as 500', async () => {
    const db = makeDb() as unknown as TestDb & { from: ReturnType<typeof vi.fn> };
    const baseFrom = db.from;
    (db as unknown as { from: ReturnType<typeof vi.fn> }).from = vi.fn((table: string) => {
      if (table === 'conversations') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({ data: { id: 'conv-1', account_id: 'acc-1', contact: { id: 'c', telegram_user_id: 123, telegram_chat_id: 123 } }, error: null }),
              }),
            }),
          }),
          update: vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) })),
        } as unknown as TestDb;
      }
      if (table === 'telegram_config') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'cfg-1', account_id: 'acc-1', bot_token_encrypted: 'enc' }, error: null }) }) }),
        } as unknown as TestDb;
      }
      if (table === 'messages') {
        // First call is reply lookup (select), second is insert (fails)
        let callCount = 0;
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => {
                  callCount++;
                  return { data: null, error: null };
                },
              }),
            }),
          }),
          insert: vi.fn(() => ({ select: () => ({ single: async () => ({ data: null, error: { message: 'db fail' } }) }) })),
        } as unknown as TestDb;
      }
      return baseFrom(table);
    });
    await expect(sendTelegramText(db, 'acc-1', { conversationId: 'conv-1', contentText: 'hi' })).rejects.toMatchObject({ code: 'db_error', status: 500 });
  });

  it('handles reply_to_message_id', async () => {
    const db = makeDb() as unknown as TestDb & { from: ReturnType<typeof vi.fn> };
    let capturedBody: Record<string, unknown> = {};
    h.fetchMock.mockImplementation(async (_url: string, opts: RequestInit) => {
      capturedBody = JSON.parse(String(opts.body));
      return { ok: true, json: async () => ({ ok: true, result: { message_id: 99 } }) } as Response;
    });
    const baseFrom = db.from;
    (db as unknown as { from: ReturnType<typeof vi.fn> }).from = vi.fn((table: string) => {
      if (table === 'conversations') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({ data: { id: 'conv-1', account_id: 'acc-1', contact: { id: 'c', telegram_user_id: 123, telegram_chat_id: 123 } }, error: null }),
              }),
            }),
          }),
          update: vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) })),
        } as unknown as TestDb;
      }
      if (table === 'telegram_config') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'cfg-1', account_id: 'acc-1', bot_token_encrypted: 'enc' }, error: null }) }) }),
        } as unknown as TestDb;
      }
      if (table === 'messages') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { id: 'parent-uuid', message_id: 'tg_123_55', conversation_id: 'conv-1' }, error: null }),
              }),
            }),
          }),
          insert: vi.fn((_row: Record<string, unknown>) => ({
            select: () => ({ single: async () => ({ data: { id: 'msg-1' }, error: null }) }),
          })),
        } as unknown as TestDb;
      }
      return baseFrom(table);
    });
    await sendTelegramText(db, 'acc-1', { conversationId: 'conv-1', contentText: 'reply', replyToMessageId: 'parent-uuid' });
    expect(capturedBody.reply_to_message_id).toBe(55);
  });
});
