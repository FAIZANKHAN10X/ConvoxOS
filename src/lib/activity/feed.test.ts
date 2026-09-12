import { describe, expect, it, vi } from 'vitest'
import { getContactActivityFeed } from './feed'

function row(
  overrides: Partial<{
    item_id: string
    item_type: string
    created_at: string
    title: string
    description: string
    metadata: Record<string, unknown>
    key: string
  }>
) {
  return {
    item_id: 'x',
    item_type: 'note_added',
    created_at: '2026-09-01T00:00:00.000Z',
    title: 'Note added',
    description: 'hello',
    metadata: {},
    key: '00000000-0000-0000-0000-000000000001',
    ...overrides,
  }
}

function mockRpc(impl: (args: Record<string, unknown>) => unknown[]) {
  const calls: Record<string, unknown>[] = []
  const supabase = {
    rpc: vi.fn(async (_fn: string, args: Record<string, unknown>) => {
      calls.push(args)
      return { data: impl(args), error: null }
    }),
  } as unknown as never
  return { supabase, calls }
}

describe('Activity Feed (RPC)', () => {
  it('returns empty when no data, single round trip', async () => {
    const { supabase, calls } = mockRpc(() => [])
    const feed = await getContactActivityFeed(supabase as never, {
      contactId: 'c1',
      accountId: 'a1',
      limit: 10,
    })
    expect(feed.items).toEqual([])
    expect(feed.nextCursor).toBeNull()
    expect(calls.length).toBe(1)
    expect(calls[0]).toMatchObject({
      p_account_id: 'a1',
      p_contact_id: 'c1',
      p_limit: 10,
      p_cursor_created_at: null,
      p_cursor_key: null,
      p_filter: 'all',
    })
  })

  it('maps rows and mints an opaque cursor only when a next page exists', async () => {
    const rows = [
      row({ item_id: 'a', created_at: '2026-09-02T00:00:00.000Z', key: 'k2' }),
      row({ item_id: 'b', created_at: '2026-09-01T00:00:00.000Z', key: 'k1' }),
    ]
    // limit 1 with 2 rows back => page of 1 + cursor
    const { supabase } = mockRpc(() => rows)
    const feed = await getContactActivityFeed(supabase as never, {
      contactId: 'c1',
      accountId: 'a1',
      limit: 1,
    })
    expect(feed.items.map((i) => i.id)).toEqual(['a'])
    expect(feed.nextCursor).toBeTruthy()
    expect(feed.items[0].timestamp).toBe('2026-09-02T00:00:00.000Z')

    // Exact page (rows == limit) => no cursor
    const { supabase: s2 } = mockRpc(() => rows.slice(0, 1))
    const feed2 = await getContactActivityFeed(s2 as never, {
      contactId: 'c1',
      accountId: 'a1',
      limit: 1,
    })
    expect(feed2.nextCursor).toBeNull()
  })

  it('paginates past identical timestamps without loss or duplication', async () => {
    const ts = '2026-09-01T00:00:00.000Z'
    const page1 = [
      row({ item_id: 'a', created_at: ts, key: 'k3' }),
      row({ item_id: 'b', created_at: ts, key: 'k2' }),
    ]
    const page2 = [row({ item_id: 'c', created_at: ts, key: 'k1' })]
    const seen: Record<string, unknown>[] = []
    const { supabase } = mockRpc((args) => {
      seen.push(args)
      // First call (no cursor) returns limit+1 rows; second returns rest
      if (!args.p_cursor_key) return [...page1, ...page2].slice(0, 3)
      return page2
    })
    const first = await getContactActivityFeed(supabase as never, {
      contactId: 'c1',
      accountId: 'a1',
      limit: 2,
    })
    expect(first.items.map((i) => i.id)).toEqual(['a', 'b'])
    expect(first.nextCursor).toBeTruthy()

    const second = await getContactActivityFeed(supabase as never, {
      contactId: 'c1',
      accountId: 'a1',
      limit: 2,
      cursor: first.nextCursor,
    })
    expect(second.items.map((i) => i.id)).toEqual(['c'])
    expect(second.nextCursor).toBeNull()
    // Cursor round-trips the (created_at, key) pair to the RPC
    expect(seen[1]).toMatchObject({
      p_cursor_created_at: ts,
      p_cursor_key: 'k2',
    })
  })

  it('restarts from the first page on a malformed cursor', async () => {
    const { supabase, calls } = mockRpc(() => [])
    await getContactActivityFeed(supabase as never, {
      contactId: 'c1',
      accountId: 'a1',
      cursor: 'not-a-cursor',
    })
    expect(calls[0]).toMatchObject({
      p_cursor_created_at: null,
      p_cursor_key: null,
    })
  })

  it('passes the type filter through to the RPC', async () => {
    const { supabase, calls } = mockRpc(() => [])
    await getContactActivityFeed(supabase as never, {
      contactId: 'c1',
      accountId: 'a1',
      filter: 'message_inbound',
    })
    expect(calls[0]).toMatchObject({ p_filter: 'message_inbound' })
  })

  it('surfaces RPC errors instead of mapping failure to empty', async () => {
    const supabase = {
      rpc: vi.fn(async () => ({ data: null, error: { message: 'boom' } })),
    } as unknown as never
    await expect(
      getContactActivityFeed(supabase as never, { contactId: 'c1', accountId: 'a1' })
    ).rejects.toThrow('activity feed: boom')
  })
})
