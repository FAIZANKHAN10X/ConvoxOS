import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NormalizedInbound } from '@/lib/channels/types'
import type { TelegramUpdate } from '@/lib/channels/types'

const h = vi.hoisted(() => ({
  state: {
    afterCallbacks: [] as (() => Promise<void>)[]
    , config: { id: 'cfg-1', account_id: 'acc-1', webhook_secret_encrypted: 'enc-secret', bot_token_encrypted: 'enc-token' }
    , account: { owner_user_id: 'user-1' }
    , profile: { user_id: 'user-1' }
    , decrypt: vi.fn((v: string) => v === 'enc-secret' ? 'mysecret' : v)
    , normalizeResult: null as NormalizedInbound | null
    , processCalls: [] as NormalizedInbound[]
    , fromCalls: [] as string[]
  },
}))

vi.mock('next/server', () => ({
  after: (cb: () => Promise<void>) => { h.state.afterCallbacks.push(cb) },
  NextResponse: { json: (body: unknown, init?: ResponseInit) => ({ body, init }) },
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      h.state.fromCalls.push(table)
      if (table === 'telegram_config') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: h.state.config, error: null }),
            }),
          }),
        }
      }
      if (table === 'accounts') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: h.state.account, error: null }),
            }),
          }),
        }
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: h.state.profile, error: null }),
              }),
            }),
          }),
        }
      }
      // fallback
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }
    },
  }),
}))

vi.mock('@/lib/crypto/encryption', () => ({
  decrypt: (v: string) => h.state.decrypt(v),
  encrypt: (v: string) => `enc-${v}`,
}))

vi.mock('@/lib/channels/telegram/normalize', () => ({
  normalizeTelegramUpdate: (_opts: { update: TelegramUpdate; accountId: string; configOwnerUserId: string }) => h.state.normalizeResult,
}))

vi.mock('@/lib/inbound/processNormalizedInbound', () => ({
  processNormalizedInbound: async (n: NormalizedInbound) => { h.state.processCalls.push(n) },
}))

function makeRequest(body: unknown, configId: string, secretHeader?: string): Request {
  const headers = new Headers()
  if (secretHeader) headers.set('x-telegram-bot-api-secret-token', secretHeader)
  headers.set('content-type', 'application/json')
  return new Request(`http://localhost/api/telegram/webhook/${configId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

describe('POST /api/telegram/webhook/[configId]', () => {
  beforeEach(() => {
    h.state.afterCallbacks = []
    h.state.processCalls = []
    h.state.fromCalls = []
    h.state.config = { id: 'cfg-1', account_id: 'acc-1', webhook_secret_encrypted: 'enc-secret', bot_token_encrypted: 'enc-token' }
    h.state.normalizeResult = {
      channel: 'telegram',
      accountId: 'acc-1',
      configOwnerUserId: 'user-1',
      providerMessageId: 'tg_1_1',
      kind: 'text',
      text: 'hi',
    }
  })

  it('rejects invalid uuid', async () => {
    const { POST } = await import('@/app/api/telegram/webhook/[configId]/route')
    const res = await POST(makeRequest({ update_id: 1 }, 'not-uuid'), { params: Promise.resolve({ configId: 'not-uuid' }) }) as unknown as { init: ResponseInit }
    expect(res.init.status).toBe(400)
  })

  it('rejects invalid secret', async () => {
    const { POST } = await import('@/app/api/telegram/webhook/[configId]/route')
    const res = await POST(makeRequest({ update_id: 1 }, '00000000-0000-4000-a000-000000000001', 'wrong'), { params: Promise.resolve({ configId: '00000000-0000-4000-a000-000000000001' }) }) as unknown as { init: ResponseInit }
    expect(res.init.status).toBe(401)
  })

  it('acks 200 and enqueues after() on valid request', async () => {
    const { POST } = await import('@/app/api/telegram/webhook/[configId]/route')
    const res = await POST(makeRequest({ update_id: 1 }, '00000000-0000-4000-a000-000000000001', 'mysecret'), { params: Promise.resolve({ configId: '00000000-0000-4000-a000-000000000001' }) }) as unknown as { init: ResponseInit }
    expect(res.init.status).toBe(200)
    expect(h.state.afterCallbacks.length).toBe(1)
    await h.state.afterCallbacks[0]()
    expect(h.state.processCalls.length).toBe(1)
    expect(h.state.processCalls[0].channel).toBe('telegram')
  })

  it('returns 200 ignored for unsupported update (null normalize)', async () => {
    h.state.normalizeResult = null
    const { POST } = await import('@/app/api/telegram/webhook/[configId]/route')
    const res = await POST(makeRequest({ update_id: 1 }, '00000000-0000-4000-a000-000000000001', 'mysecret'), { params: Promise.resolve({ configId: '00000000-0000-4000-a000-000000000001' }) }) as unknown as { body: { status: string }; init: ResponseInit }
    expect(res.body.status).toBe('ignored')
    expect(h.state.afterCallbacks.length).toBe(0)
  })

  it('does not decrypt bot_token for routing (only secret)', async () => {
    h.state.decrypt.mockClear()
    const { POST } = await import('@/app/api/telegram/webhook/[configId]/route')
    await POST(makeRequest({ update_id: 1 }, '00000000-0000-4000-a000-000000000001', 'mysecret'), { params: Promise.resolve({ configId: '00000000-0000-4000-a000-000000000001' }) })
    // decrypt should have been called only for webhook_secret, not bot_token
    const calls = h.state.decrypt.mock.calls.map((c: [string]) => c[0])
    expect(calls).toContain('enc-secret')
    expect(calls).not.toContain('enc-token')
  })
})
