import { createClient } from '@/lib/supabase/server'
import { getCurrentAccount } from '@/lib/auth/account'
import {
  loadMetricsCached,
  loadPipelineCached,
  loadResponseTimeCached,
  loadSeriesCached,
} from '@/lib/dashboard/queries-cached'
import { loadActivity } from '@/lib/dashboard/queries'
import {
  daysAgoStart,
  lastNDayKeys,
  mondayIndex,
  startOfLocalDay,
} from '@/lib/dashboard/date-utils'
import { DashboardClient } from './dashboard-client'

// Server-first hybrid: data loads via RSC (single Supabase hop,
// streamed HTML, no client waterfall). Interactive islands (range
// toggle, derived UI) live in DashboardClient.
//
// T2.2 streaming: the five loaders are kicked off together but NOT
// awaited here. Each promise flows to its own section inside
// DashboardClient, where React 19 `use()` suspends only that
// section's boundary — a slow response-time query no longer holds
// the KPI ribbon hostage. Per-loader .catch preserves the
// established null → skeleton contract (no error UI exists;
// rejections must not escape into an error boundary).
//
// T2.3 caching: the four aggregate loaders are `use cache` with a
// ~1-minute TTL, keyed per account (identity resolved here, outside
// the cache scope, and passed in). Activity stays live (freshness
// matters, queries are already bounded).
export default async function DashboardPage() {
  const supabase = await createClient()
  const { accountId } = await getCurrentAccount()

  // All wall-clock reads happen HERE, at request time outside every
  // `use cache` scope. The cached loaders take them as plain args
  // (part of the cache key); reading time inside a cache scope
  // would poison keys and trip prerender validation.
  const now = new Date()
  const todayStart = startOfLocalDay(now).toISOString()
  const yesterdayStart = daysAgoStart(1).toISOString()
  const seriesStart = daysAgoStart(29).toISOString()
  const seriesKeys = lastNDayKeys(30)
  const rtStart = daysAgoStart(13).toISOString()
  const thisWeekStart = daysAgoStart(mondayIndex(now)).toISOString()
  const lastWeekStart = daysAgoStart(mondayIndex(now) + 7).toISOString()

  const metrics = loadMetricsCached(accountId, todayStart, yesterdayStart).catch((err) => {
    console.error('[dashboard] metrics failed:', err)
    return null
  })
  const series30 = loadSeriesCached(accountId, 30, 'UTC', seriesStart, seriesKeys).catch((err) => {
    console.error('[dashboard] series failed:', err)
    return null
  })
  const pipeline = loadPipelineCached(accountId).catch((err) => {
    console.error('[dashboard] pipeline failed:', err)
    return null
  })
  const responseTime = loadResponseTimeCached(accountId, rtStart, thisWeekStart, lastWeekStart).catch((err) => {
    console.error('[dashboard] response time failed:', err)
    return null
  })
  const activity = loadActivity(supabase, 50).catch((err: unknown) => {
    console.error('[dashboard] activity failed:', err)
    return null
  })

  return (
    <DashboardClient
      metricsPromise={metrics}
      series30Promise={series30}
      pipelinePromise={pipeline}
      responseTimePromise={responseTime}
      activityPromise={activity}
    />
  )
}
