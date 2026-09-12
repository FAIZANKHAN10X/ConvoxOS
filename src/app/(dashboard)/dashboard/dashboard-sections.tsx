import { createClient } from '@/lib/supabase/server'
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

// Dynamic data island for the dashboard shell (see page.tsx).
// Runs after the shell: account identity arrives as a plain prop
// (resolved outside every `use cache` scope), wall-clock bounds
// are computed here at request time and passed into the cached
// loaders as args. Nothing in this module executes during shell
// prerender — the parent Suspense boundary suspends first (the
// `await createClient()` below reads cookies and suspends
// cleanly, unlike a clock read which would return an unstable
// value and trip blocking-prerender validation).
export async function DashboardSections({ accountId }: { accountId: string }) {
  const supabase = await createClient()

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
