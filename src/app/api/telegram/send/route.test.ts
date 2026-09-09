import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const conversationInserts: Array<Record<string, unknown>> = []
let existingConversation: Record<string, unknown> | null = null
let contactRow: Record<string, unknown> | null = null
let callerRole: string = 'admin'
let createdConversation: Record<string, unknown> | null = null
let rateLimitShouldFail = false

const CONTACT_TG = {
  id: 'contact-1',
  account_id: 'acct-1',
  telegram_user_id: 12345,
  telegram_chat_id: 12345,
  phone: null as string | null,
}

function makeSupabaseMock() {
  function builder(table: string) {
    let didInsert = false
    const selectResult = () => {
      switch (table) {
        case 'profiles':
          return { data: { account_id: 'acct-1', account_role: callerRole }, error: null }
        case 'accounts':
          return { data: { id: 'acct-1', name: 'Acme' }, error: null }
        case 'contacts':
          return { data: contactRow, error: null }
        case 'conversations':
          return { data: createdConversation ?? existingConversation, error: null }
        default:
          return { data: null, error: null }
      }
    }
    const insertResult = () => {
      switch (table) {
        case 'conversations':
          return {
            data: { id: 'conv-new', account_id: 'acct-1', contact_id: 'contact-1', contact: CONTACT_TG },
            error: null,
          }
        default:
          return { data: null, error: null }
      }
    }
    const terminal = () => Promise.resolve(didInsert ? insertResult() : selectResult())
    const b: Record<string, unknown> = {}
    const chain = () => b
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'update', 'delete']) b[m] = vi.fn(chain)
    b.insert = vi.fn((payload: Record<string, unknown>) => {
      didInsert = true
      if (table === 'conversations') {
        conversationInserts.push(payload)
        createdConversation = { id: 'conv-new', account_id: 'acct-1', contact_id: 'contact-1', contact: CONTACT_TG }
      }
      return b
    })
    b.single = vi.fn(terminal)
    b.maybeSingle = vi.fn(terminal)
    ;(b as Record<string, unknown>).then = (resolve: (v: unknown) => unknown) => resolve(didInsert ? insertResult() : selectResult())
    return b
  }
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })) },
    from: vi.fn((table: string) => builder(table)),
  }
}

let supabaseMock = makeSupabaseMock()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => supabaseMock),
}))

vi.mock('@/lib/rate-limit', async () => {
  const actual = await vi.importActual('@/lib/rate-limit') as Record<string, unknown>
  return {
    ...actual,
    checkRateLimit: vi.fn(() => (rateLimitShouldFail ? { success: false, remaining: 0 } : { success: true, remaining: 10 })),
    rateLimitResponse: vi.fn(() => ({ status: 429, json: async () => ({ error: 'Rate limited' }) })),
    RATE_LIMITS: actual.RATE_LIMITS,
  }
})

const { sendTelegramText } = vi.hoisted(() => ({
  sendTelegramText: vi.fn(async () => ({ messageId: 'msg-1', telegramMessageId: 'tg_123_42' })),
}))
vi.mock('@/lib/channels/telegram/send', () => ({
  sendTelegramText,
  SendTelegramError: class SendTelegramError extends Error {
    code: string
    status: number
    constructor(code: string, message: string, status: number) {
      super(message)
      this.code = code
      this.status = status
    }
  },
}))

import { POST } from './route'

function postTelegram(overrides: Record<string, unknown> = {}) {
  return POST(
    new Request('http://localhost/api/telegram/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: 'conv-existing',
        content_text: 'hello',
        ...overrides,
      }),
    })
  )
}

function postContactText(overrides: Record<string, unknown> = {}) {
  return POST(
    new Request('http://localhost/api/telegram/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contact_id: 'contact-1',
        content_text: 'hello',
        ...overrides,
      }),
    })
  )
}

describe('POST /api/telegram/send — text', () => {
  beforeEach(() => {
    conversationInserts.length = 0
    existingConversation = null
    createdConversation = null
    contactRow = CONTACT_TG
    callerRole = 'admin'
    rateLimitShouldFail = false
    supabaseMock = makeSupabaseMock()
    sendTelegramText.mockClear()
    // Default: conversation exists
    existingConversation = { id: 'conv-existing', account_id: 'acct-1', contact_id: 'contact-1', contact: CONTACT_TG }
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('sends text to existing conversation', async () => {
    const res = await postTelegram()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.telegram_message_id).toBe('tg_123_42')
    expect(sendTelegramText).toHaveBeenCalledTimes(1)
    expect(sendTelegramText).toHaveBeenCalledWith(expect.anything(), 'acct-1', expect.objectContaining({ conversationId: 'conv-existing', contentText: 'hello' }))
  })

  it('creates conversation for contact with none', async () => {
    existingConversation = null
    const res = await postContactText()
    expect(res.status).toBe(200)
    expect(conversationInserts).toHaveLength(1)
    expect(conversationInserts[0]).toMatchObject({ account_id: 'acct-1', contact_id: 'contact-1' })
  })

  it('reuses existing conversation', async () => {
    existingConversation = { id: 'conv-existing', account_id: 'acct-1', contact_id: 'contact-1', contact: CONTACT_TG }
    const res = await postContactText()
    expect(res.status).toBe(200)
    expect(conversationInserts).toHaveLength(0)
  })

  it('404s when contact not in account', async () => {
    contactRow = null
    const res = await postContactText()
    expect(res.status).toBe(404)
    expect(sendTelegramText).not.toHaveBeenCalled()
  })

  it('400s when neither conversation_id nor contact_id', async () => {
    const res = await POST(
      new Request('http://localhost/api/telegram/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_text: 'hi' }),
      })
    )
    expect(res.status).toBe(400)
  })

  it('400s when content_text missing', async () => {
    const res = await postTelegram({ content_text: '' })
    expect(res.status).toBe(400)
    expect(sendTelegramText).not.toHaveBeenCalled()
  })

  it('refuses viewer with 403 before Telegram', async () => {
    callerRole = 'viewer'
    const res = await postTelegram()
    expect(res.status).toBe(403)
    expect(sendTelegramText).not.toHaveBeenCalled()
  })

  it('allows agent', async () => {
    callerRole = 'agent'
    const res = await postTelegram()
    expect(res.status).toBe(200)
    expect(sendTelegramText).toHaveBeenCalledTimes(1)
  })

  it('rate limits with 429', async () => {
    rateLimitShouldFail = true
    const res = await postTelegram()
    expect(res.status).toBe(429)
    expect(sendTelegramText).not.toHaveBeenCalled()
  })

  it('propagates sender error with correct status', async () => {
    const { SendTelegramError } = await import('@/lib/channels/telegram/send')
    sendTelegramText.mockRejectedValueOnce(new SendTelegramError('telegram_error', 'Unauthorized', 502))
    const res = await postTelegram()
    expect(res.status).toBe(502)
    const json = await res.json()
    expect(json.error).toMatch(/Unauthorized/)
  })
})
