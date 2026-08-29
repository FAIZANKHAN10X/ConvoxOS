import { describe, it, expect } from 'vitest'
import { normalizeTelegramUpdate } from '@/lib/channels/telegram/normalize'
import type { TelegramUpdate } from '@/lib/channels/types'

describe('normalizeTelegramUpdate', () => {
  const accountId = 'acc-1'
  const configOwnerUserId = 'user-1'

  it('normalizes text message', () => {
    const update: TelegramUpdate = {
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
    const update: TelegramUpdate = {
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

  it('normalizes caption-bearing photo as media with caption text', () => {
    const update: TelegramUpdate = {
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
    expect(n.kind).toBe('media')
    expect(n.text).toBe('photo caption')
    expect(n.mediaUrl).toBe('abc')
    expect(n.mediaType).toBe('image/jpeg')
  })

  it('normalizes photo without caption as media placeholder', () => {
    const update: TelegramUpdate = {
      update_id: 110,
      message: {
        message_id: 9,
        from: { id: 1, first_name: 'A' },
        chat: { id: 1, type: 'private' },
        date: 1,
        photo: [{ file_id: 'fid1' }, { file_id: 'fid2' }],
      },
    }
    const n = normalizeTelegramUpdate({ update, accountId, configOwnerUserId })!
    expect(n.kind).toBe('media')
    expect(n.mediaUrl).toBe('fid2') // largest last
    expect(n.text).toBe('[media]')
  })

  it('normalizes document as media with mime and filename', () => {
    const update: TelegramUpdate = {
      update_id: 111,
      message: {
        message_id: 10,
        from: { id: 5, first_name: 'C' },
        chat: { id: 5, type: 'private' },
        date: 1,
        document: { file_id: 'doc123', file_name: 'invoice.pdf', mime_type: 'application/pdf' },
      },
    }
    const n = normalizeTelegramUpdate({ update, accountId, configOwnerUserId })!
    expect(n.kind).toBe('media')
    expect(n.mediaUrl).toBe('doc123')
    expect(n.mediaType).toBe('application/pdf')
    expect((n as unknown as { telegramFileName: string }).telegramFileName).toBe('invoice.pdf')
  })

  it('normalizes document with caption as media preserving caption', () => {
    const update: TelegramUpdate = {
      update_id: 112,
      message: {
        message_id: 11,
        from: { id: 6, first_name: 'D' },
        chat: { id: 6, type: 'private' },
        date: 12,
        caption: 'see attached',
        document: { file_id: 'doc999', file_name: 'a.pdf', mime_type: 'application/pdf' },
      },
    }
    const n = normalizeTelegramUpdate({ update, accountId, configOwnerUserId })!
    expect(n.kind).toBe('media')
    expect(n.text).toBe('see attached')
    expect(n.mediaUrl).toBe('doc999')
  })

  it('returns null for unsupported update', () => {
    const update: TelegramUpdate = { update_id: 103, edited_message: { message_id: 1 } }
    expect(normalizeTelegramUpdate({ update, accountId, configOwnerUserId })).toBeNull()
  })

  it('normalizes location', () => {
    const update: TelegramUpdate = {
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
