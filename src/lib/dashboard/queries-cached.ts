// NOTE: no `server-only` import — the package is intentionally not
// a dependency (T1.7 decision). This module is only ever imported
// by dashboard/page.tsx (server); 'use cache' functions cannot run
// on the client regardless, so a client import fails loudly.
import { cacheLife } from 'next/cache'
import { supabaseAdmin } from '@/lib/supabase/admin'
import type {
  ConversationsSeriesPoint,
  MetricsBundle,
  PipelineDonutData,
  ResponseTimeSummary,
} from './types'
import { daysAgoStart, lastNDayKeys } from './date-utils'
import { startOfLocalDay } from './date-utils'

// T2.3 cached dashboard loaders. Rules followed throughout:
//
// - Identity is resolved OUTSIDE the cache scope (page.tsx reads
//   the account via the user client) and passed in as a plain
//   string, so the cache key is per-account and no request data
//   (cookies) enters the cached scope.
// - Queries run with the service-role client because a user client
//   cannot enter a cache scope (it closes over cookies). Account
//   isolation rests on the explicit p_account_id predicates every
//   dashboard RPC enforces (migrations 064/066/068, all SECURITY
//   INVOKER) — audited in T1, not assumed.
// - Freshness: cacheLife('minutes') — dashboard numbers may lag
//   ~1 minute. Acceptable for an internal CRM; the range toggle
//   and all mutations still read live via the uncached loaders.
// - This module is server-only and imported only by page.tsx.
//   The client range toggle keeps using queries.ts.

export async function loadMetricsCached(
  accountId: string
): Promise<MetricsBundle> {
  'use cache'
  cacheLife('minutes')
  const db = supabaseAdmin()
  const todayStart = startOfLocalDay().toISOString()
  const yesterdayStart = daysAgoStart(1).toISOString()
  const { data, error } = await db.rpc('dashboard_metrics', {
    p_account_id: accountId,
    p_today_start: todayStart,
    p_yesterday_start: yesterdayStart,
  })
  if (error) throw error
  const m = (Array.isArray(data) ? data[0] : data) as {
    open_conv: number
    new_conv_today: number
    new_conv_yesterday: number
    new_contacts_today: number
    new_contacts_yesterday: number
    open_deals_count: number
    open_deals_value: string | number
    msgs_today: number
    msgs_yesterday: number
  }
  return {
    activeConversations: {
      current: Number(m.open_conv ?? 0),
      previous: Number(m.new_conv_today ?? 0) - Number(m.new_conv_yesterday ?? 0),
    },
    newContactsToday: {
      current: Number(m.new_contacts_today ?? 0),
      previous: Number(m.new_contacts_yesterday ?? 0),
    },
    openDealsValue: Number(m.open_deals_value ?? 0),
    openDealsCount: Number(m.open_deals_count ?? 0),
    messagesSentToday: {
      current: Number(m.msgs_today ?? 0),
      previous: Number(m.msgs_yesterday ?? 0),
    },
  }
}

export async function loadSeriesCached(
  accountId: string,
  rangeDays: number,
  tz: string
): Promise<ConversationsSeriesPoint[]> {
  'use cache'
  cacheLife('minutes')
  const db = supabaseAdmin()
  const start = daysAgoStart(rangeDays - 1).toISOString()
  const { data, error } = await db.rpc('dashboard_series', {
    p_account_id: accountId,
    p_start: start,
    p_tz: tz,
  })
  if (error) throw error
  const keys = lastNDayKeys(rangeDays)
  const buckets = new Map<string, { incoming: number; outgoing: number }>()
  for (const k of keys) buckets.set(k, { incoming: 0, outgoing: 0 })
  for (const row of (data ?? []) as {
    day: string
    incoming: number
    outgoing: number
  }[]) {
    const bucket = buckets.get(row.day)
    if (!bucket) continue
    bucket.incoming += Number(row.incoming ?? 0)
    bucket.outgoing += Number(row.outgoing ?? 0)
  }
  return keys.map((day) => ({
    day,
    ...(buckets.get(day) ?? { incoming: 0, outgoing: 0 }),
  }))
}

export async function loadPipelineCached(
  accountId: string
): Promise<PipelineDonutData> {
  'use cache'
  cacheLife('minutes')
  const db = supabaseAdmin()
  const { data, error } = await db.rpc('dashboard_pipeline', {
    p_account_id: accountId,
  })
  if (error) throw error
  const slices = (
    (data ?? []) as {
      stage_id: string
      stage_name: string
      stage_color: string | null
      deal_count: number
      total_value: string | number
    }[]
  )
    .map((s) => ({
      id: s.stage_id,
      name: s.stage_name,
      color: s.stage_color || '#64748b',
      dealCount: Number(s.deal_count ?? 0),
      totalValue: Number(s.total_value ?? 0),
    }))
    .filter((s) => s.totalValue > 0 || s.dealCount > 0)
  return {
    stages: slices,
    totalValue: slices.reduce((sum, s) => sum + s.totalValue, 0),
  }
}

export async function loadResponseTimeCached(
  accountId: string
): Promise<ResponseTimeSummary> {
  'use cache'
  cacheLife('minutes')
  const db = supabaseAdmin()
  const fourteenDaysAgo = daysAgoStart(13).toISOString()
  const { data, error } = await db.rpc('dashboard_response_samples', {
    p_account_id: accountId,
    p_start: fourteenDaysAgo,
  })
  if (error) throw error
  // Bucketing/averaging identical to queries.ts loadResponseTime.
  const { mondayIndex } = await import('./date-utils')
  const samples: { customerAt: Date; responseAt: Date }[] = (
    (data ?? []) as { customer_at: string; minutes: string | number }[]
  )
    .map((r) => {
      const customerAt = new Date(r.customer_at)
      const minutes = Number(r.minutes)
      return {
        customerAt,
        responseAt: new Date(customerAt.getTime() + minutes * 60_000),
      }
    })
    .filter(
      (s) =>
        Number.isFinite(s.customerAt.getTime()) &&
        Number.isFinite(s.responseAt.getTime())
    )

  const now = new Date()
  const thisWeekStart = daysAgoStart(mondayIndex(now))
  const lastWeekStart = daysAgoStart(mondayIndex(now) + 7)
  const byDow = new Map<number, number[]>()
  for (let i = 0; i < 7; i++) byDow.set(i, [])
  const thisWeekMins: number[] = []
  const lastWeekMins: number[] = []
  for (const s of samples) {
    const diffMin = (s.responseAt.getTime() - s.customerAt.getTime()) / 60_000
    if (diffMin < 0) continue
    const dow = mondayIndex(s.customerAt)
    byDow.get(dow)!.push(diffMin)
    if (s.customerAt >= thisWeekStart) {
      thisWeekMins.push(diffMin)
    } else if (s.customerAt >= lastWeekStart && s.customerAt < thisWeekStart) {
      lastWeekMins.push(diffMin)
    }
  }
  const avg = (arr: number[]) =>
    arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length
  return {
    buckets: Array.from({ length: 7 }, (_, dow) => {
      const bucketSamples = byDow.get(dow) ?? []
      return {
        dow,
        avgMinutes: avg(bucketSamples),
        samples: bucketSamples.length,
      }
    }),
    thisWeekAvg: avg(thisWeekMins),
    lastWeekAvg: avg(lastWeekMins),
  }
}
