import { describe, expect, it, vi } from 'vitest'
import {
  loadConversationsSeries,
  loadMetrics,
  loadPipelineDonut,
  loadResponseTime,
} from './queries'

// Mock user client: getUser + profiles lookup, then per-test rpc.
function mockDb(rpcImpl: (fn: string, args: Record<string, unknown>) => unknown) {
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = () => chain
  chain.maybeSingle = async () => ({ data: { account_id: 'a1' }, error: null })
  return {
    calls,
    db: {
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
      from: () => chain,
      rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args })
        return { data: rpcImpl(fn, args), error: null }
      }),
    } as never,
  }
}

describe('dashboard loaders (RPC)', () => {
  it('loadMetrics maps nine scalars with identical definitions', async () => {
    const { db, calls } = mockDb(() => [
      {
        open_conv: 7,
        new_conv_today: 3,
        new_conv_yesterday: 1,
        new_contacts_today: 4,
        new_contacts_yesterday: 2,
        open_deals_count: 5,
        open_deals_value: '1234.5',
        msgs_today: 9,
        msgs_yesterday: 6,
      },
    ])
    const m = await loadMetrics(db)
    expect(calls.map((c) => c.fn)).toEqual(['dashboard_metrics'])
    expect(m.activeConversations).toEqual({ current: 7, previous: 2 })
    expect(m.newContactsToday).toEqual({ current: 4, previous: 2 })
    expect(m.openDealsValue).toBe(1234.5)
    expect(m.openDealsCount).toBe(5)
    expect(m.messagesSentToday).toEqual({ current: 9, previous: 6 })
  })

  it('loadConversationsSeries zero-fills missing days', async () => {
    const { db } = mockDb(() => [{ day: '2026-09-10', incoming: 2, outgoing: 3 }])
    const series = await loadConversationsSeries(db, 3, 'UTC')
    expect(series.length).toBe(3)
    const hit = series.find((p) => p.day === '2026-09-10')
    expect(hit).toMatchObject({ incoming: 2, outgoing: 3 })
    expect(series.filter((p) => p.day !== '2026-09-10').every((p) => p.incoming === 0 && p.outgoing === 0)).toBe(true)
  })

  it('loadPipelineDonut hides empty stages and totals', async () => {
    const { db } = mockDb(() => [
      { stage_id: 's1', stage_name: 'New', stage_color: null, deal_count: 2, total_value: '100' },
      { stage_id: 's2', stage_name: 'Empty', stage_color: '#fff', deal_count: 0, total_value: '0' },
    ])
    const d = await loadPipelineDonut(db)
    expect(d.stages.length).toBe(1)
    expect(d.stages[0]).toMatchObject({ id: 's1', color: '#64748b', dealCount: 2, totalValue: 100 })
    expect(d.totalValue).toBe(100)
  })

  it('loadResponseTime averages samples exactly like before', async () => {
    const { db } = mockDb(() => [
      { customer_at: '2026-09-07T10:00:00.000Z', minutes: 30 }, // Monday
      { customer_at: '2026-09-07T11:00:00.000Z', minutes: 10 }, // Monday
    ])
    const r = await loadResponseTime(db)
    const monday = r.buckets[0]
    expect(monday.samples).toBe(2)
    expect(monday.avgMinutes).toBe(20)
    expect(r.buckets.slice(1).every((b) => b.avgMinutes === null)).toBe(true)
  })

  it('loaders throw when signed out', async () => {
    const db = {
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      from: () => { throw new Error('no db without account') },
      rpc: vi.fn(),
    } as never
    await expect(loadMetrics(db)).rejects.toThrow('not signed in')
  })
})
