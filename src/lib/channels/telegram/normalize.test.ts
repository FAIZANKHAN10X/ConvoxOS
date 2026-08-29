import { describe, it, expect } from 'vitest'
import { normalizeTelegramUpdate } from '@/lib/channels/telegram/normalize'

describe('normalizeTelegramUpdate', () => {
  const accountId = 'acc-1'
  const configOwnerUserId = 'user-1'

  it('normalizes text message', () => {
    const update: any = {
      update_id: 100,
      message: {
        message_id: 42,
        from: { id: 12345, username: 'alice', first_name: 'Alice', last_name: 'Smith' },
        chat: { id: 12345, type: 'private' },
        date: 1234567890,
        text: 'hello',
      },
    }
    const n = normalizeTelegramUpdate({ update, accountId, configOwnerUserId })
    expect(n).not.toBeNull()
    expect(n!.channel).toBe('telegram')
    expect(n!.providerMessageId).toBe('tg_12345_42')
    expect(n!.kind).toBe('text')
    expect(n!.text).toBe('hello')
    expect(n!.telegramUserId).toBe(12345)
    expect(n!.telegramChatId).toBe(12345)
    expect(n!.telegramUsername).toBe('alice')
    expect(n!.senderName).toBe('Alice Smith')
  })

  it('normalizes callback_query to interactive_reply', () => {
    const update: any = {
      update_id: 101,
      callback_query: {
        id: 'cb-1',
        from: { id: 999, username: 'bob', first_name: 'Bob' },
        message: { message_id: 5, chat: { id: 999 } },
        data: 'btn_yes',
      },
    }
    const n = normalizeTelegramUpdate({ update, accountId, configOwnerUserId })
    expect(n!.kind).toBe('interactive_reply')
    expect(n!.replyId).toBe('btn_yes')
    expect(n!.replyTitle).toBe('btn_yes')
    expect(n!.providerMessageId).toBe('tg_cb_cb-1')
    expect(n!.telegramUserId).toBe(999)
  })

  it('normalizes caption as text', () => {
    const update: any = {
      update_id: 102,
      message: {
        message_id: 7,
        from: { id: 1, first_name: 'A' },
        chat: { id: 1, type: 'private' },
        date: 1,
        caption: 'photo caption',
        photo: [{ file_id: 'abc' }],
      },
    }
    const n = normalizeTelegramUpdate({ update, accountId, configOwnerUserId })!
    expect(n.kind).toBe('text')
    expect(n.text).toBe('photo caption')
  })

  it('returns null for unsupported update', () => {
    const update: any = { update_id: 103, edited_message: { message_id: 1 } }
    expect(normalizeTelegramUpdate({ update, accountId, configOwnerUserId })).toBeNull()
  })

  it('normalizes location', () => {
    const update: any = {
      update_id: 104,
      message: {
        message_id: 8,
        from: { id: 2, first_name: 'B' },
        chat: { id: 2, type: 'private' },
        date: 1,
        location: { latitude: 1, longitude: 2 },
      },
    }
    const n = normalizeTelegramUpdate({ update, accountId, configOwnerUserId })!
    expect(n.kind).toBe('location')
    expect(n.text).toBe('1,2')
  })
})
