import { createClient } from '@/lib/supabase/server'
import {
  loadActivity,
  loadConversationsSeries,
  loadMetrics,
  loadPipelineDonut,
  loadResponseTime,
} from '@/lib/dashboard/queries'
import { DashboardClient } from './dashboard-client'

export const dynamic = 'force-dynamic'

// Server-first hybrid: data loads via RSC (single Supabase hop,
// streamed HTML, no client waterfall). Interactive islands (range
// toggle, derived UI) live in DashboardClient.
//
// T2.2 streaming: the five loaders are kicked off together but NOT
// awaited here. Each promise flows to its own section inside
// DashboardClient, where React 19 `use()` suspends only that
// section's boundary — a slow response-time query no longer holds
// the KPI ribbon hostage. Per-loader .catch preserves the
// established null → skeleton contract (no error UI exists today;
// rejections must not escape into an error boundary).
export default async function DashboardPage() {
  const supabase = await createClient()

  const metrics = loadMetrics(supabase).catch((err) => {
    console.error('[dashboard] metrics failed:', err)
    return null
  })
  const series30 = loadConversationsSeries(supabase, 30).catch((err) => {
    console.error('[dashboard] series failed:', err)
    return null
  })
  const pipeline = loadPipelineDonut(supabase).catch((err) => {
    console.error('[dashboard] pipeline failed:', err)
    return null
  })
  const responseTime = loadResponseTime(supabase).catch((err) => {
    console.error('[dashboard] response time failed:', err)
    return null
  })
  const activity = loadActivity(supabase, 50).catch((err) => {
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
