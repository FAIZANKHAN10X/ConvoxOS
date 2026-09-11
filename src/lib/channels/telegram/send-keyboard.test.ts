import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/crypto/encryption', () => ({
  encrypt: vi.fn((s: string) => `enc:${s}`),
  decrypt: vi.fn((s: string) => (s.startsWith('enc:') ? s.slice(4) : s)),
  isLegacyFormat: vi.fn(() => false),
}));
describe('sendTelegramText with inline keyboard', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, result: { message_id: 7 } }) }) as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('includes reply_markup for text+keyboard and persists interactive', async () => {
    const { sendTelegramText } = await import('./send');
    const db = {
      from: vi.fn((table: string) => {
        if (table === 'conversations') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(async () => ({
                    data: { id: 'conv-1', account_id: 'acct-1', contact: { id: 'ct-1', telegram_user_id: 1, telegram_chat_id: 1 } },
                    error: null,
                  })),
                })),
              })),
            })),
            update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
          } as never;
        }
        if (table === 'telegram_config') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: { id: 'cfg-1', bot_token_encrypted: 'enc:tok' }, error: null })) })),
            })),
            update: vi.fn(() => ({ eq: vi.fn(() => ({ then: (r: (v: unknown) => void) => r({ error: null }) })) })),
          } as never;
        }
        if (table === 'messages') {
          let captured: unknown = null;
          return {
            insert: vi.fn((payload: unknown) => {
              captured = payload;
              // expose for assertion via global
              (global as unknown as Record<string, unknown>).__capturedInsert = captured;
              return {
                select: vi.fn(() => ({
                  single: vi.fn(async () => ({ data: { id: 'msg-1' }, error: null })),
                })),
              };
            }),
          } as never;
        }
        return { select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn(async () => ({ data: null, error: null })) })) })) })) } as never;
      }),
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    const kb = { inline_keyboard: [[{ text: 'Yes', callback_data: 'yes' }, { text: 'Visit', url: 'https://example.com' }]] };
    const res = await sendTelegramText(db, 'acct-1', { conversationId: 'conv-1', contentText: 'Pick', inlineKeyboard: kb });
    expect(res.telegramMessageId).toBe('tg_1_7');
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.reply_markup.inline_keyboard[0][0].callback_data).toBe('yes');
    expect(body.reply_markup.inline_keyboard[0][1].url).toBe('https://example.com');
    const inserted = (global as unknown as Record<string, unknown>).__capturedInsert as { content_type: string; interactive_payload: { kind: string } };
    expect(inserted.content_type).toBe('interactive');
    expect(inserted.interactive_payload.kind).toBe('telegram_inline');
  });

  it('rejects invalid keyboard at provider layer', async () => {
    const { sendTelegramText } = await import('./send');
    const db = { from: vi.fn() } as unknown as import('@supabase/supabase-js').SupabaseClient;
    const bad = { inline_keyboard: [[{ text: '', callback_data: 'a' }]] } as unknown as import('./keyboard').TelegramInlineMarkup;
    await expect(
      sendTelegramText(db, 'acct-1', { conversationId: 'c', contentText: 'hi', inlineKeyboard: bad }),
    ).rejects.toThrow(/text is required/);
  });

  it('text without keyboard sends no reply_markup and content_type text', async () => {
    const { sendTelegramText } = await import('./send');
    const db = {
      from: vi.fn((table: string) => {
        if (table === 'conversations')
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(async () => ({
                    data: { id: 'c', account_id: 'a', contact: { id: 'ct', telegram_user_id: 1, telegram_chat_id: 1 } },
                    error: null,
                  })),
                })),
              })),
            })),
            update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
          } as never;
        if (table === 'telegram_config')
          return {
            select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: { id: 'x', bot_token_encrypted: 'enc:tok' }, error: null })) })) })),
            update: vi.fn(() => ({ eq: vi.fn(() => ({ then: (r: (v: unknown) => void) => r({ error: null }) })) })),
          } as never;
        if (table === 'messages')
          return {
            insert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn(async () => ({ data: { id: 'm' }, error: null })) })) })),
          } as never;
        return { select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn(async () => ({ data: null, error: null })) })) })) } as never;
      }),
    } as unknown as import('@supabase/supabase-js').SupabaseClient;
    await sendTelegramText(db, 'a', { conversationId: 'c', contentText: 'hi' });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.reply_markup).toBeUndefined();
  });
});
