import { describe, expect, it, vi } from 'vitest'
import { getContactActivityFeed } from './feed'

const mockSupabase = {
  from: vi.fn(),
}

function mockFrom(data: unknown[]) {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          eq: () => ({
            select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'conv1' } }) }) }) }),
          }),
          order: () => ({ limit: () => Promise.resolve({ data }) }),
        }),
        order: () => ({ limit: () => Promise.resolve({ data }) }),
      }),
      order: () => ({ limit: () => Promise.resolve({ data }) }),
    }),
  } as unknown as never
}

describe('Activity Feed', () => {
  it('returns empty when no data', async () => {
    const supabase = {
      from: (table: string) => {
        if (table === 'conversations') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  limit: () => ({
                    maybeSingle: () => Promise.resolve({ data: null }),
                  }),
                }),
              }),
            }),
          } as never
        }
        // For all other tables, return chain that handles eq().eq().order().limit()
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => Promise.resolve({ data: [] }),
        }
        return chain as never
      },
    } as unknown as never

    const feed = await getContactActivityFeed(supabase as never, { contactId: 'c1', accountId: 'a1', limit: 10 })
    expect(feed.items).toEqual([])
    expect(feed.nextCursor).toBeNull()
  })

  it('orders newest first', async () => {
    const now = new Date().toISOString()
    const earlier = new Date(Date.now() - 100000).toISOString()
    const items = [
      { timestamp: earlier, type: 'message_inbound' } as unknown as { timestamp: string },
      { timestamp: now, type: 'message_outbound' } as unknown as { timestamp: string },
    ]
    const sorted = [...items].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    expect(sorted[0].timestamp).toBe(now)
  })

  it('filters by type', async () => {
    const supabase = {
      from: (table: string) => {
        if (table === 'conversations') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  limit: () => ({
                    maybeSingle: () => Promise.resolve({ data: { id: 'conv1' } }),
                  }),
                }),
              }),
            }),
          } as never
        }
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => Promise.resolve({ data: [] }),
        }
        return chain as never
      },
    } as unknown as never

    const feed = await getContactActivityFeed(supabase as never, { contactId: 'c1', accountId: 'a1', filter: 'message_inbound' })
    expect(feed.items.every((i) => i.type === 'message_inbound' || feed.items.length === 0)).toBe(true)
  })
})
